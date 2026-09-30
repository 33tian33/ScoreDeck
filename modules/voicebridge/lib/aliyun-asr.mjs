import { randomUUID } from 'node:crypto';
import WebSocket from './vendor/ws/wrapper.mjs';

export const DEFAULT_ALIYUN_WS = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

function failure(message, retryable = false) {
  const error = new Error(message);
  error.retryable = retryable;
  return error;
}

// Paraformer emits milliseconds. The existing pipeline consumes seconds relative
// to this persisted audio job; it adds the authoritative local capture offset.
export function sentenceSegment(sentence) {
  if (!sentence || sentence.heartbeat || sentence.sentence_end !== true) return null;
  if (typeof sentence.text !== 'string' || !sentence.text.trim()) return null;
  const words = Array.isArray(sentence.words) ? sentence.words : [];
  const starts = words.map(w => w.begin_time).filter(Number.isFinite);
  const ends = words.map(w => w.end_time).filter(Number.isFinite);
  const start = Number.isFinite(sentence.begin_time) ? sentence.begin_time : Math.min(...starts);
  const end = Number.isFinite(sentence.end_time) ? sentence.end_time : Math.max(...ends);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw failure('阿里云最终识别结果缺少有效时间码');
  }
  return { start: start / 1000, end: end / 1000, text: sentence.text.trim() };
}

function pcmFromWav(wave) {
  if (!Buffer.isBuffer(wave) || wave.length < 44 || wave.toString('ascii', 0, 4) !== 'RIFF' || wave.toString('ascii', 8, 12) !== 'WAVE') {
    throw failure('ASR 输入必须为 PCM WAV');
  }
  let rate, channels, bits, format, pcm;
  for (let pos = 12; pos + 8 <= wave.length;) {
    const size = wave.readUInt32LE(pos + 4), kind = wave.toString('ascii', pos, pos + 4);
    if (pos + 8 + size > wave.length) throw failure('WAV 数据不完整');
    if (kind === 'fmt ' && size >= 16) {
      format = wave.readUInt16LE(pos + 8); channels = wave.readUInt16LE(pos + 10);
      rate = wave.readUInt32LE(pos + 12); bits = wave.readUInt16LE(pos + 22);
    }
    if (kind === 'data') pcm = wave.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + size % 2;
  }
  if (format !== 1 || channels !== 1 || bits !== 16 || !pcm?.length || rate < 8000 || rate > 48000) {
    throw failure('阿里云适配器需要 8–48kHz / 单声道 / 16位 PCM WAV');
  }
  return { pcm, rate };
}

export async function transcribeAliyun(wave, {
  apiKey, wsUrl = DEFAULT_ALIYUN_WS, model = 'paraformer-realtime-v2',
  language = 'zh', vocabularyId = '', timeoutMs = 30000, workspaceId = '',
  WebSocketImpl = WebSocket
} = {}) {
  if (!apiKey) throw failure('未配置 DASHSCOPE_API_KEY（阿里云百炼北京地域）');
  const url = new URL(wsUrl);
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw failure('ASR_WS_URL 必须使用 wss://');
  }
  const { pcm, rate } = pcmFromWav(wave);
  const taskId = randomUUID();
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (workspaceId) headers['X-DashScope-WorkSpace'] = workspaceId;
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(wsUrl, {
      headers, handshakeTimeout: Math.min(timeoutMs, 15000),
      perMessageDeflate: false, maxPayload: 2 * 1024 * 1024
    });
    const segments = new Map();
    let settled = false, started = false, finishing = false, offset = 0, sendTimer;
    const timer = setTimeout(() => complete(failure('阿里云 ASR 调用超时', true)), timeoutMs);

    function complete(error) {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(sendTimer);
      // Stop sockets even on a handshake failure; error listeners remain attached.
      ws.terminate();
      if (error) reject(error);
      else resolve([...segments.values()].sort((a, b) => a.start - b.start));
    }
    function sendJson(value) {
      ws.send(JSON.stringify(value), error => { if (error) complete(failure('阿里云 WebSocket 发送失败', true)); });
    }
    function sendAudio() {
      if (settled) return;
      if (ws.readyState !== WebSocket.OPEN) return complete(failure('阿里云连接中断', true));
      if (ws.bufferedAmount > 1024 * 1024) {
        sendTimer = setTimeout(sendAudio, 50); return;
      }
      if (offset >= pcm.length) {
        finishing = true;
        sendJson({ header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' }, payload: { input: {} } });
        return;
      }
      const end = Math.min(pcm.length, offset + Math.round(rate / 10) * 2);
      ws.send(pcm.subarray(offset, end), { binary: true }, error => {
        if (error) complete(failure('阿里云音频发送失败', true));
      });
      offset = end;
      sendTimer = setTimeout(sendAudio, 100);
    }
    ws.on('open', () => sendJson({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio', task: 'asr', function: 'recognition', model,
        parameters: { format: 'pcm', sample_rate: rate, language_hints: [language],
          semantic_punctuation_enabled: false, max_sentence_silence: 800,
          punctuation_prediction_enabled: true, ...(vocabularyId?{vocabulary_id:vocabularyId}:{}) },
        input: {}
      }
    }));
    ws.on('message', (data, isBinary) => {
      if (settled || isBinary) return;
      try {
        const message = JSON.parse(data.toString());
        const header = message.header || {};
        if (header.task_id !== taskId) return;
        switch (header.event) {
          case 'task-started':
            if (!started) { started = true; sendAudio(); }
            break;
          case 'result-generated': {
            if (!started) throw failure('阿里云返回顺序异常');
            const s = sentenceSegment(message.payload?.output?.sentence);
            if (s) segments.set(`${s.start}:${s.end}`, s);
            break;
          }
          case 'task-finished':
            if (!finishing) throw failure('阿里云提前结束任务，音频尚未发送完整', true);
            complete(); break;
          case 'task-failed': {
            const code = String(header.error_code || 'UNKNOWN');
            // Never expose provider error messages that could echo credentials.
            const retryable = /throttl|rate|limit|timeout|internal|server|unavailable/i.test(code);
            throw failure(`阿里云 ASR 失败：${code}；请检查地域、模型权限、余额或稍后重试`, retryable);
          }
        }
      } catch (error) { complete(error); }
    });
    ws.on('unexpected-response', (_request, response) => {
      response.resume();
      const code = response.statusCode;
      complete(failure(`阿里云握手 HTTP ${code}；401/403 请检查北京地域 API Key 和模型权限`, code === 429 || code >= 500));
    });
    ws.on('error', () => complete(failure('阿里云 WebSocket 连接失败，请检查网络与接口地址', true)));
    ws.on('close', () => { if (!settled) complete(failure('阿里云连接提前关闭，未收到 task-finished', true)); });
  });
}
