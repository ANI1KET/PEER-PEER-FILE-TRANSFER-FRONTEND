let fileBuffers: { [key: string]: Uint8Array[] } = {};
let receivedSizes: { [key: string]: number } = {};
let fileSizes: { [key: string]: number } = {};
let mimeTypes: { [key: string]: string } = {};

self.onmessage = (e: MessageEvent) => {
  const { type, data, socketId } = e.data;

  switch (type) {
    case "metadata":
      fileBuffers[socketId] = [];
      receivedSizes[socketId] = 0;
      fileSizes[socketId] = data.size;
      mimeTypes[socketId] = data.mimeType;
      break;

    case "chunk":
      const chunk = new Uint8Array(data);
      if (!fileBuffers[socketId]) {
        console.error("No buffer found for socketId:", socketId);
        return;
      }
      fileBuffers[socketId].push(chunk);
      receivedSizes[socketId] += chunk.byteLength;

      self.postMessage({
        type: "receiving",
        received: Math.floor(
          (receivedSizes[socketId] / fileSizes[socketId]) * 100
        ),
      });

      if (receivedSizes[socketId] >= fileSizes[socketId]) {
        const blob = new Blob(fileBuffers[socketId], {
          type: mimeTypes[socketId],
        });
        self.postMessage({ type: "fileComplete", socketId, blob });

        delete fileBuffers[socketId];
        delete receivedSizes[socketId];
        delete fileSizes[socketId];
        delete mimeTypes[socketId];
      }
      break;

    default:
      console.error("Unknown message type in Web Worker:", type);
  }
};
