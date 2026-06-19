import { loadData } from './loader';
import server from './server';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

// 起動時に1回だけマスタデータを読み込む（Lambda コールドスタート）
loadData();

server.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
  server.log.info(`Yamato Master API listening at ${address}`);
});
