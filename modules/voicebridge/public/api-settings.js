const $=id=>document.getElementById(id);
let canRestart=false;
const modelDrafts={aliyun:'paraformer-realtime-v2',openai:'whisper-1'};
let provider='aliyun';
function fields(){
 const aliyun=$('apiProvider').value==='aliyun';
 $('aliyunFields').hidden=!aliyun;$('openaiFields').hidden=aliyun;
 $('deepseekFields').hidden=$('apiAnalysis').value==='local';
 $('apiModels').replaceChildren(...(aliyun?['paraformer-realtime-v2']:['whisper-1']).map(v=>{const o=document.createElement('option');o.value=v;return o;}));
}
async function request(url,body){
 const r=await fetch(url,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok)throw new Error(data.error||'请求失败');return data;
}
const mapping={ASR_MODEL:'apiModel',ASR_LANGUAGE:'apiLanguage',ASR_WS_URL:'apiWs',ASR_BASE_URL:'apiBase',DASHSCOPE_WORKSPACE_ID:'apiWorkspace',ASR_VOCABULARY_ID:'apiVocabulary',DEEPSEEK_MODEL:'apiDeepModel'};
const keys={DASHSCOPE_API_KEY:'aliyunKey',OPENAI_API_KEY:'openaiKey',DEEPSEEK_API_KEY:'deepseekKey'};
function status(v){for(const [key,id] of Object.entries(keys)){$(id).value='';$(id).placeholder=v[key+'_SET']?'已配置 · 留空保留':'尚未配置 · 请填写';}}
async function load(){
 const r=await request('/api/settings/api');canRestart=r.canRestart;const v=r.values;
 provider=v.ASR_PROVIDER;$('apiProvider').value=provider;
 for(const [k,id] of Object.entries(mapping)){if(k==='ASR_LANGUAGE'&&![...$(id).options].some(o=>o.value===v[k]))$(id).add(new Option(v[k],v[k]));$(id).value=v[k];}
 modelDrafts[provider]=v.ASR_MODEL;$('apiStreaming').checked=v.ASR_STREAMING==='true';
 $('apiAnalysis').value=v.DEEPSEEK_ENABLED==='false'?'local':'deepseek';
 status(v);fields();$('apiRestart').disabled=!canRestart;
 $('apiMessage').textContent=r.restartRequired?'配置已保存，重启后生效。':'已读取当前配置。密钥不会回传到页面。';
}
$('apiProvider').onchange=()=>{modelDrafts[provider]=$('apiModel').value;provider=$('apiProvider').value;$('apiModel').value=modelDrafts[provider];fields();};
$('apiAnalysis').onchange=fields;
$('apiShowKeys').onchange=()=>{for(const id of Object.values(keys))$(id).type=$('apiShowKeys').checked?'text':'password';};
$('apiForm').onsubmit=async e=>{
 e.preventDefault();$('apiSave').disabled=true;
 try{
 const v={ASR_PROVIDER:$('apiProvider').value,ASR_STREAMING:String($('apiStreaming').checked),DEEPSEEK_ENABLED:String($('apiAnalysis').value==='deepseek')};
 for(const [k,id] of Object.entries({...mapping,...keys}))v[k]=$(id).value;
 const r=await request('/api/settings/api',v);status(r.values);
 $('apiMessage').textContent=canRestart?'保存成功。点击“重启服务并应用”生效。':'保存成功。请关闭服务后重新启动以应用配置。';
 }catch(e){$('apiMessage').textContent=e.message;}finally{$('apiSave').disabled=false;}
};
$('apiRestart').onclick=async()=>{
 $('apiRestart').disabled=true;
 try{await request('/api/desktop/restart',{});$('apiMessage').textContent='正在重启服务…';
 await new Promise(r=>setTimeout(r,1500));
 for(let i=0;i<40;i++){try{await request('/healthz');location.reload();return;}catch{}await new Promise(r=>setTimeout(r,500));}
 throw new Error('请检查启动窗口，服务尚未恢复。');
 }catch(e){$('apiMessage').textContent=e.message;$('apiRestart').disabled=!canRestart;}
};
$('apiInstallHotwords').onclick=async()=>{
 $('apiInstallHotwords').disabled=true;$('apiMessage').textContent='正在向北京地域创建 CS2 热词表…';
 try{
  const r=await request('/api/settings/hotwords/cs2',{});
  $('apiVocabulary').value=r.vocabularyId;
  $('apiMessage').textContent=`${r.reused?'已复用':'已创建'} ${r.count} 条热词，词表 ID 已保存。点击“重启服务并应用”生效。`;
 }catch(e){$('apiMessage').textContent=e.message;}
 finally{$('apiInstallHotwords').disabled=false;}
};
Promise.all([load(),request('/api/settings/hotwords')]).then(([,preset])=>{
 $('apiHotwordsInfo').textContent=`CS2 现役七图 + 游戏术语 · ${preset.count} 条 · ${preset.version}。可在 data/cs2-hotwords-v1.json 核对词条。`;
}).catch(e=>{$('apiMessage').textContent=e.message;$('apiSave').disabled=true;});
