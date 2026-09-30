const path = require("node:path");
const { createBroadcastServer } = require("./broadcast-server.cjs");

const root = path.resolve(__dirname, "..");
const app = createBroadcastServer({ webRoot: path.join(root, "dist"), dataDir: path.join(root, "data") });

app.listen().then((meta) => {
  console.log("ScoreDeck CS 导播服务已启动");
  console.log(`控制台: ${meta.localUrl}/`);
  console.log(`OBS:    ${meta.localUrl}/output/live`);
  console.log(`倒计时: ${meta.countdownLocalUrl}`);
  for (const url of meta.networkUrls) console.log(`局域网:  ${url}/`);
  for (const url of meta.countdownNetworkUrls) console.log(`倒计时局域网: ${url}`);
});

process.on("SIGINT", async () => { await app.close(); process.exit(0); });
process.on("SIGTERM", async () => { await app.close(); process.exit(0); });
