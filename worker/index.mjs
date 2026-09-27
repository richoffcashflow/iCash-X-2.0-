import http from "node:http";

// Railway's worker stays dormant until the durable queue, tenant budgets,
// provider credentials, and channel release policies are connected.
// Never turn this process into a polling loop that can spend credits by itself.
const port = Number(process.env.PORT || 3001);
const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "standby", outreachEnabled: false }));
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(port, "0.0.0.0", () => {
  console.log(`iCash X worker in standby on port ${port}`);
});
