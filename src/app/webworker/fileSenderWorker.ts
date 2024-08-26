self.onmessage = async function (e) {
  const { file } = e.data;
  const chunkSize = 16384;

  let offset = 0;
  let isReading = false;

  const readNextChunk = () => {
    if (offset < file.size) {
      isReading = true;
      const chunk = file.slice(offset, offset + chunkSize);
      const reader = new FileReader();

      reader.onload = function (event) {
        if (event.target?.result) {
          self.postMessage({
            type: "chunk",
            chunk: event.target.result,
            offset,
            done: Math.floor((offset / file.size) * 100),
          });
          offset += chunkSize;
          isReading = false;
        }
      };

      reader.onerror = function (error) {
        self.postMessage({
          type: "fileError",
          error: error,
        });
        isReading = false;
      };

      reader.readAsArrayBuffer(chunk);
    } else {
      const progress = Math.floor((offset / file.size) * 100);
      self.postMessage({
        type: "complete",
        done: progress > 100 ? 100 : progress,
      });
    }
  };

  readNextChunk();

  self.onmessage = function (event) {
    if (event.data.type === "read-next-chunk" && !isReading) {
      readNextChunk();
    }
  };
};
