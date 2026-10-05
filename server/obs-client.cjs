'use strict';
const crypto = require('node:crypto');
const WebSocket = require('../modules/voicebridge/lib/vendor/ws');

// One connection per transaction; callers serialize scene ownership transactions.
function connect(config) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(config.url, { handshakeTimeout: 4000, maxPayload: 4 * 1024 * 1024 });
    const pending = new Map();
    let ready = false;
    const deadline = setTimeout(() => fail(Error('OBS 连接或认证超时')), 5000);
    function fail(error) {
      clearTimeout(deadline);
      if (!ready) reject(error);
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
      pending.clear();
      ws.terminate();
    }
    ws.on('error', () => fail(Error('无法连接 OBS，请检查 WebSocket 地址、端口和 OBS 是否运行')));
    ws.on('close', () => fail(Error('OBS 连接已关闭，请检查密码或重新连接')));
    ws.on('message', bytes => {
      try {
        const {op, d} = JSON.parse(bytes);
        if (op === 0) {
          const identify = {rpcVersion: 1, eventSubscriptions: 0};
          if (d.authentication) {
            const hash = s => crypto.createHash('sha256').update(s).digest('base64');
            identify.authentication = hash(hash(config.password + d.authentication.salt) + d.authentication.challenge);
          }
          ws.send(JSON.stringify({op: 1, d: identify}));
        } else if (op === 2) {
          ready = true; clearTimeout(deadline);
          resolve({
            close: () => ws.close(),
            call(requestType, requestData = {}) {
              return new Promise((resolve, reject) => {
                const requestId = crypto.randomUUID();
                const timer = setTimeout(() => { pending.delete(requestId); reject(Error('OBS 操作超时：' + requestType)); }, 5000);
                pending.set(requestId, {resolve, reject, timer});
                ws.send(JSON.stringify({op: 6, d: {requestId, requestType, requestData}}), error => {
                  if (error) fail(Error('OBS 发送失败'));
                });
              });
            }
          });
        } else if (op === 7) {
          const p = pending.get(d.requestId); if (!p) return;
          pending.delete(d.requestId); clearTimeout(p.timer);
          if (d.requestStatus?.result) p.resolve(d.responseData || {});
          else p.reject(Error('OBS 操作失败：' + (d.requestStatus?.comment || d.requestStatus?.code)));
        }
      } catch { fail(Error('OBS 返回了无效数据')); }
    });
  });
}
module.exports = {connect};
