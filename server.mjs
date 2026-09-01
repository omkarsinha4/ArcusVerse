import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { loadStore, advertiseUrls } from "./server/store.mjs";
import { attachSockets } from "./server/sockets.mjs";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const store = loadStore();
const httpServer = createServer((req, res) => handle(req, res));
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true }
});

const urls = advertiseUrls(port);
attachSockets(io, store, urls);

httpServer.listen(port, hostname, () => {
  console.log("\n  ArcusVerse auction is live\n");
  if (urls.mode === "public") {
    console.log(`  App (admin / owner / auctioneer):  ${urls.appUrl}`);
    console.log(`  Spectator:                         ${urls.spectatorUrls[0]}`);
  } else {
    console.log(`  This machine:  http://localhost:${port}`);
    if (urls.lan.length) {
      for (const ip of urls.lan) {
        console.log(`  Same Wi-Fi:    http://${ip}:${port}`);
      }
    } else {
      console.log("  No LAN IPv4 found — set PUBLIC_URL for internet hosting.");
    }
  }
  console.log("");
});
