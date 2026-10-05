(()=>{'use strict';
const section=document.createElement('article');section.id='obs-highlights';section.style.marginTop='24px';
section.innerHTML=`<h2>OBS 独立场景自动播出</h2>
<p>半场：播放完毕或第 13 回合剩余时间到达 1:50，先发生者返回进入精选前的 OBS 场景。全场：播放完毕后返回指定的直播控制场景。</p>
<div class="grid">
 <label class="check"><input id="obs-enabled" type="checkbox">启用 OBS 自动切场</label>
 <label>OBS WebSocket 地址<input id="obs-url" placeholder="ws://127.0.0.1:4455"></label>
 <label>OBS WebSocket 密码<input id="obs-password" type="password" autocomplete="new-password" placeholder="留空保留已保存密码"></label>
 <label class="check"><input id="obs-clear-password" type="checkbox">清除已保存密码（仅用于 OBS 关闭认证时）</label>
 <label>精选 OBS 场景<input id="obs-highlight" list="obs-scenes" placeholder="ScoreDeck 精选"></label>
 <label>全场结束后返回的 OBS 场景<input id="obs-live" list="obs-scenes" placeholder="ScoreDeck 直播控制"></label>
</div><datalist id="obs-scenes"></datalist>
<div class="buttons"><button id="obs-save" class="primary">保存 OBS 设置</button><button id="obs-test">保存并测试连接 / 读取场景</button><button id="obs-copy">复制 OBS 精选专用地址</button><button id="obs-copy-live">复制直播控制输出地址</button></div>
<p id="obs-status" role="status"></p><p id="obs-result" role="status"></p>
<div class="buttons"><button id="obs-show-half">试播半场精选</button><button id="obs-show-full">试播全场精选</button><button id="obs-stop">结束精选并返回</button></div>
<h3>OBS 详细配置步骤</h3>
<ol class="obs-guide">
 <li><strong>打开 OBS 的 WebSocket 服务。</strong>在 OBS「工具 → WebSocket 服务器设置」勾选「启用 WebSocket 服务器」，端口通常为 4455。启用身份认证，复制服务器密码。OBS 与 ScoreDeck 在同一电脑时，上方填写 <code>ws://127.0.0.1:4455</code>；OBS 在另一电脑时填写那台电脑的局域网 IP 和实际端口，并允许该端口通过防火墙。</li>
 <li><strong>创建精选场景。</strong>在 OBS 左下角「场景」点击「＋」，命名为「ScoreDeck 精选」。在这个场景的「来源」点击「＋ → 浏览器」，新建「ScoreDeck 精选输出」。点击上方「复制 OBS 精选专用地址」，粘贴到浏览器源 URL；宽度填 1920、高度填 1080。地址带有 <code>?obs=1</code>，不要使用预览地址。</li>
 <li><strong>让精选浏览器源保持加载。</strong>在该浏览器源属性中取消勾选「不可见时关闭源」和「场景变为活动状态时刷新浏览器」。这样 ScoreDeck 能在切场前确认素材已经加载。右键来源「变换 → 适配屏幕」。精选场景只需放精选输出，不要再放游戏捕获；需要完整背景时，在精选画面设置里关闭透明背景。</li>
 <li><strong>配置声音。</strong>浏览器源勾选「通过 OBS 控制音频」，在混音器中确认该源没有静音、音量合适，并在「高级音频属性」勾选实际直播使用的音轨。通常将音频监听设为「关闭监听」；如需耳机监听，可使用「监听并输出」并检查是否重复收音。精选画面里的 Replay 元素也要取消静音。</li>
 <li><strong>创建直播控制场景。</strong>再新建「ScoreDeck 直播控制」场景，添加一个 1920×1080 浏览器源，URL 使用上方「复制直播控制输出地址」得到的 <code>/output/live</code>。这个输出跟随 ScoreDeck「直播控制」栏目选择的画面；不要把后台控制页面当作输出源。</li>
 <li><strong>绑定场景。</strong>上方两个场景名称必须与 OBS 中完全一致。填写地址、密码后点击「保存并测试连接 / 读取场景」，从下拉提示选择实际名称。测试只读取场景，不会切换。勾选「启用 OBS 自动切场」并保存。半场返回场景会在每次切入前自动记录，无须填写。</li>
 <li><strong>准备自动触发与素材。</strong>启动 Replay，确认当前地图的半场／全场精选片单中有可播放素材；启动 RadarHUD 并接入正在进行的比赛 GSI。勾选本栏目上方「GSI 检测中场后自动播出」和「第 13 回合 1:50 自动返回」；全场自动触发在「半场 / 全场画面编辑」中开启。精选画面至少保留一个 Replay 元素。</li>
 <li><strong>先试播再正式使用。</strong>在 OBS 切到游戏场景，点击「试播半场精选」，应自动进入精选场景，片单播完后回到原游戏场景。再点击「试播全场精选」，应在播完后进入「ScoreDeck 直播控制」。也可随时点击「结束精选并返回」。正式比赛中，半场遇到第 13 回合正式进行且剩余时间 ≤1:50 时会提前结束，不会在冻结时间提前切走。</li>
</ol>
<h3>播出规则与故障检查</h3>
<ul class="obs-guide">
 <li>OBS 自动播出固定本次片单，Replay 只播放一遍；背景视频和雷达循环不会延长精选。修改片单、布局或播放速度在下次播出生效。</li>
 <li>全场精选沿用当前逻辑：当前地图进入 gameover 时触发，包含加时；不是等待整个 BO 系列赛全部结束。</li>
 <li>45 秒内没有可播素材或输出页未就绪，会取消本次切场并显示原因；可修复后手动试播。播放错误或输出页心跳中断时会尝试返回。OBS 断开导致无法返回时会保留返回任务并重试。</li>
 <li>导播手动切到其他 OBS 场景后，当前精选会退出，不再自动抢回；需要重播请再次点击试播。播出期间不要刷新精选浏览器源，也不要从其他回放工具发起切场。</li>
 <li>不要在普通浏览器中打开带 <code>obs=1</code> 的专用地址，也不要创建多个相同专用源；预览请使用栏目上方预览或固定输出地址。如果 OBS 在另一电脑，请从已授权的控制台复制专用地址；其中可能包含导播授权参数，仅粘贴到自己的 OBS。</li>
 <li>若未触发 1:50 返回，先检查 GSI 连接、比赛是否为第 13 回合、回合倒计时是否有效及自动返回开关。缺少或过期的 GSI 数据不会用于强制返回，片单播完仍会返回。</li>
</ul>`;
document.querySelector('main').append(section);
const $=id=>document.getElementById(id);let dirty=false,busy=false;
section.addEventListener('input',()=>dirty=true);
function fill(c){$('obs-enabled').checked=c.enabled;$('obs-url').value=c.url;$('obs-highlight').value=c.highlightScene;$('obs-live').value=c.liveScene;$('obs-password').placeholder=c.hasPassword?'已保存密码；留空保留':'输入 OBS WebSocket 密码';}
async function refresh(){try{const s=await(await fetch('/api/highlights/obs',{cache:'no-store'})).json();if(!dirty&&!busy)fill(s.config);$('obs-status').textContent=s.error||s.run?.waitMessage|| (s.run?({preparing:'正在等待素材和输出页就绪',playing:'正在 OBS 播出',returning:'正在返回 OBS 场景'}[s.run.status]||s.run.status):s.config.enabled?(s.connected?'OBS 已连接 · 自动切场已启用':'自动切场已启用 · 等待连接'):'OBS 自动切场未启用');}catch{$('obs-status').textContent='无法读取 OBS 状态';}}
const post=body=>SDClient.request('/api/highlights/obs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function save(){const s=await post({action:'settings',settings:{enabled:$('obs-enabled').checked,url:$('obs-url').value.trim(),password:$('obs-password').value,clearPassword:$('obs-clear-password').checked,highlightScene:$('obs-highlight').value.trim(),liveScene:$('obs-live').value.trim()}});dirty=false;$('obs-password').value='';$('obs-clear-password').checked=false;fill(s.config);}
async function action(fn){if(busy)return;busy=true;for(const b of section.querySelectorAll('button'))b.disabled=true;try{await fn();}catch(e){$('obs-result').textContent=e.message;}finally{busy=false;for(const b of section.querySelectorAll('button'))b.disabled=false;await refresh();}}
$('obs-save').onclick=()=>action(async()=>{await save();$('obs-result').textContent='OBS 设置已保存';});
$('obs-test').onclick=()=>action(async()=>{await save();const s=await post({action:'test'});$('obs-scenes').replaceChildren(...s.scenes.map(n=>new Option(n,n)));const missing=[$('obs-highlight').value,$('obs-live').value].filter(n=>!s.scenes.includes(n));$('obs-result').textContent='连接成功，当前场景：'+s.currentScene+(missing.length?'。请创建或重新选择：'+missing.join('、'):'。两个目标场景均已找到。');});
async function copy(live){const u=new URL(live?'/output/live':'/output/halftime-auto?obs=1',location.origin);if(!live&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname)){const key=SDClient.authHeaders()['X-ScoreDeck-Key'];if(key)u.searchParams.set('key',key);}try{await navigator.clipboard.writeText(u.href);$('obs-result').textContent='已复制'+(live?'直播控制输出':'精选专用输出')+'地址';}catch{$('obs-result').textContent=u.href;}}
$('obs-copy').onclick=()=>copy(false);$('obs-copy-live').onclick=()=>copy(true);
for(const [id,mode]of [['obs-show-half','half'],['obs-show-full','full'],['obs-stop',null]])$(id).onclick=()=>action(async()=>{if(mode&&dirty)await save();const s=await(await fetch('/api/halftime',{cache:'no-store'})).json();await SDClient.request('/api/halftime/program',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:mode?'show':'hide',mode,expectedRevision:s.config.revision})});$('obs-result').textContent=mode?'已请求播出，请观察 OBS 场景与上方状态':'已结束精选';});
addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
refresh();setInterval(refresh,2000);
})();
