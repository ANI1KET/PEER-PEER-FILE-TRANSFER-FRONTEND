"use client";

import React, { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SocketIO, { disconnectSocket, socketIo } from "@/app/utils/socketIo";
import { ConnectedUser, UserMessage } from "@/app/utils/types";

const File = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userName = searchParams.get("username");
  const meetingId = searchParams.get("meetingId");

  if (!userName) {
    router.back();
  }

  const [remoteUsers, setRemoteUsers] = useState<ConnectedUser[]>([]);
  const RtcPeerConnection = useRef<{ [key: string]: RTCPeerConnection | null }>(
    {}
  );
  const dataChannels = useRef<{ [key: string]: RTCDataChannel | null }>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileBuffers = useRef<{ [key: string]: Uint8Array[] }>({});
  const fileSizes = useRef<{ [key: string]: number }>({});
  const receivedSizes = useRef<{ [key: string]: number }>({});
  const fileNames = useRef<{ [key: string]: string[] }>({});
  const mimeTypes = useRef<{ [key: string]: string }>({});

  const [completeFiles, setCompleteFiles] = useState<{ [key: string]: Blob[] }>(
    {}
  );
  const [sendingprogress, setSendingProgress] = useState<string>("");
  const [receivingprogress, setReceivingProgress] = useState<string>("");

  const sendingFileQueue = useRef<File[]>([]);
  const isSendingFile = useRef<boolean>(false);

  const fileReceiverWorker = useRef<{ [key: string]: Worker | null }>({});

  useEffect(() => {
    const createConnection = async (socketId: string) => {
      const rtcPeerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: ["stun:stun.l.google.com:19302"] },
          // { urls: "stun:stun.l.google.com:5349" },
          // { urls: "stun:stun1.l.google.com:3478" },
          // {
          //   urls: "turn:192.158.29.39:3478?transport=tcp",
          //   credential: "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
          //   username: "28224511:1379330808",
          // },
          // {
          //   urls: "turn:192.158.29.39:3478?transport=udp",
          //   credential: "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
          //   username: "28224511:1379330808",
          // },
          // {
          //   urls: "turn:turn.bistri.com:80",
          //   credential: "homeo",
          //   username: "homeo",
          // },
        ],
      });

      rtcPeerConnection.onnegotiationneeded = async () => {
        if (RtcPeerConnection.current[socketId]) {
          const offer = await RtcPeerConnection.current[
            socketId
          ]?.createOffer();
          await RtcPeerConnection.current[socketId]?.setLocalDescription(offer);
          socketIo?.emit("SDPSetUp", {
            message: JSON.stringify({ offer }),
            socketId,
          });
        }
      };

      rtcPeerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socketIo?.emit("SDPSetUp", {
            message: JSON.stringify({ iceCandidate: event.candidate }),
            socketId,
          });
        }
      };

      const dataChannel = rtcPeerConnection.createDataChannel("fileTransfer");
      // const dataChannel = rtcPeerConnection.createDataChannel("fileTransfer",{
      //   ordered: true,
      //   reliable: true
      // });
      dataChannel.onopen = () =>
        console.log(`Data channel open with ${socketId}`);
      dataChannel.onclose = () =>
        console.log(`Data channel closed with ${socketId}`);
      // dataChannel.onmessage = (event) =>
      //   handleIncomingMessage(event.data, socketId);

      dataChannels.current[socketId] = dataChannel;

      rtcPeerConnection.ondatachannel = (event) => {
        const remoteChannel = event.channel;
        remoteChannel.onmessage = (event) => {
          if (!fileReceiverWorker.current[socketId]) {
            fileReceiverWorker.current[socketId] = new Worker(
              new URL("@/app/webworker/fileReceiverWorker.ts", import.meta.url)
            );
          }
          handleIncomingMessage(event.data, socketId);
        };
      };

      RtcPeerConnection.current[socketId] = rtcPeerConnection;
    };

    if (!socketIo && userName && meetingId) {
      SocketIO(`${process.env.NEXT_PUBLIC_BASE_URL}`, userName, meetingId);
    }

    socketIo?.on("connect", () =>
      console.log("Connected to Socket.IO server ", socketIo?.id)
    );

    socketIo?.on("Notify_User", (ConnectedUsers: ConnectedUser) => {
      setRemoteUsers((prevUsers) => [...prevUsers, ConnectedUsers]);
    });

    socketIo?.on("Connected_User", async (ConnectedUsers: ConnectedUser[]) => {
      setRemoteUsers((prevUsers) => [...prevUsers, ...ConnectedUsers]);
      for (const user of ConnectedUsers) {
        await createConnection(user.socketId);
      }
    });

    socketIo?.on(
      "SDPSetUp",
      async ({ message, from }: { message: string; from: string }) => {
        const userMessage: UserMessage = JSON.parse(message);
        switch (Object.keys(userMessage)[0]) {
          case "iceCandidate":
            if (!RtcPeerConnection.current[from]) await createConnection(from);
            await RtcPeerConnection.current[from]?.addIceCandidate(
              new RTCIceCandidate(userMessage.iceCandidate)
            );
            break;
          case "offer":
            if (!RtcPeerConnection.current[from]) await createConnection(from);
            await RtcPeerConnection.current[from]?.setRemoteDescription(
              new RTCSessionDescription(userMessage.offer)
            );
            const answer = await RtcPeerConnection.current[
              from
            ]?.createAnswer();
            await RtcPeerConnection.current[from]?.setLocalDescription(answer);
            socketIo?.emit("SDPSetUp", {
              message: JSON.stringify({ answer }),
              socketId: from,
            });
            break;
          case "answer":
            await RtcPeerConnection.current[from]?.setRemoteDescription(
              new RTCSessionDescription(userMessage.answer)
            );
            break;
        }
      }
    );

    socketIo?.on("Notify_User_Disconnect", (socketId: string) => {
      RtcPeerConnection.current[socketId]?.close();
      RtcPeerConnection.current[socketId] = null;
      dataChannels.current[socketId]?.close();
      dataChannels.current[socketId] = null;

      delete fileReceiverWorker.current[socketId];

      setRemoteUsers((prevUsers) =>
        prevUsers.filter((user) => user.socketId !== socketId)
      );
    });

    return () => {
      socketIo?.off("connect");
      socketIo?.off("SDPSetUp");
      socketIo?.off("Notify_User");
      socketIo?.off("Connected_User");
      socketIo?.off("Notify_User_Disconnect");
      disconnectSocket();
    };
  }, [meetingId, userName]);

  useEffect(() => {
    return () => {
      disconnectSocket();

      // Clear the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      // Reset refs to their initial empty state
      dataChannels.current = {};
      fileBuffers.current = {};
      fileSizes.current = {};
      receivedSizes.current = {};
      fileNames.current = {};
      mimeTypes.current = {};

      // Reset file sending state
      isSendingFile.current = false;
      sendingFileQueue.current = [];

      // Terminate workers and reset fileReceiverWorker ref
      Object.keys(fileReceiverWorker.current).forEach((key) => {
        const worker = fileReceiverWorker.current[key];
        if (worker) {
          worker.terminate();
        }
      });
      fileReceiverWorker.current = {};
    };
  }, []);

  const processNextFileInQueue = () => {
    if (sendingFileQueue.current.length > 0 && !isSendingFile.current) {
      const file = sendingFileQueue.current.shift();
      if (file) {
        sendFile(file);
      }
    }
  };

  const handleFileUpload = () => {
    const file = fileInputRef.current?.files?.[0];
    if (file) {
      sendingFileQueue.current.push(file);
      processNextFileInQueue();
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const sendFile = (file: File) => {
    isSendingFile.current = true;

    const fileSenderWorker = new Worker(
      new URL("@/app/webworker/fileSenderWorker.ts", import.meta.url)
    );

    Object.values(dataChannels.current).forEach((dataChannel) => {
      if (dataChannel) {
        try {
          dataChannel.send(
            JSON.stringify({
              type: "metadata",
              name: file.name,
              mimeType: file.type,
              size: file.size,
            })
          );

          dataChannel.onbufferedamountlow = () => {
            if (dataChannel.bufferedAmount === 0) {
              fileSenderWorker.postMessage({ type: "read-next-chunk" });
            }
          };
        } catch (metadataError) {
          console.error("Error sending metadata : ", metadataError);
          isSendingFile.current = false;
          fileSenderWorker.terminate();
          return;
        }
      }
    });

    fileSenderWorker.postMessage({ file });

    fileSenderWorker.onmessage = (e: MessageEvent) => {
      const { type, chunk, done, error } = e.data;

      switch (type) {
        case "chunk":
          Object.values(dataChannels.current).forEach((dataChannel) => {
            if (dataChannel) {
              try {
                dataChannel.send(chunk);

                dataChannel.onbufferedamountlow = () => {
                  if (dataChannel.bufferedAmount === 0) {
                    fileSenderWorker.postMessage({ type: "read-next-chunk" });
                  }
                };
              } catch (error) {
                if (
                  error instanceof DOMException &&
                  error.name === "OperationError"
                ) {
                  setTimeout(() => {
                    fileSenderWorker.postMessage({ type: "read-next-chunk" });
                  }, 100);
                } else {
                  console.error("Error sending data:", error);
                  isSendingFile.current = false;
                  fileSenderWorker.terminate();
                  return;
                }
              }
            }
          });
          console.log(done);
          setSendingProgress(done);
          break;

        case "complete":
          isSendingFile.current = false;
          processNextFileInQueue();
          fileSenderWorker.terminate();
          setSendingProgress(done);
          break;

        case "fileError":
          console.error("Error:", error);
          isSendingFile.current = false;
          fileSenderWorker.terminate();
          break;
      }
    };
  };

  const handleIncomingMessage = (data: any, socketId: string) => {
    if (typeof data === "string") {
      const metadata = JSON.parse(data);
      if (metadata.type === "metadata") {
        if (!fileNames.current[socketId]) {
          fileNames.current[socketId] = [];
        }
        fileNames.current[socketId].push(metadata.name);

        fileReceiverWorker.current[socketId]?.postMessage({
          type: "metadata",
          data: metadata,
          socketId,
        });
      }
    } else if (data instanceof ArrayBuffer) {
      fileReceiverWorker.current[socketId]?.postMessage({
        type: "chunk",
        data,
        socketId,
      });
    } else {
      fileReceiverWorker.current[socketId]?.terminate();
      console.error("Received data is not in the expected format");
    }

    (fileReceiverWorker.current[socketId] as Worker).onmessage = (
      e: MessageEvent
    ) => {
      const { type, blob, received } = e.data;

      switch (type) {
        case "receiving":
          setReceivingProgress(received);
          break;

        case "fileComplete":
          setCompleteFiles((prev) => ({
            ...prev,
            [socketId]: [...(prev[socketId] || []), blob],
          }));
          // fileReceiverWorker.current[socketId]?.terminate();
          // fileReceiverWorker.current[socketId] = null;
          // delete fileReceiverWorker.current[socketId];
          break;

        default:
          fileReceiverWorker.current[socketId]?.terminate();
          fileReceiverWorker.current[socketId] = null;
          console.error("Received data is not in the expected format");
      }
    };
  };

  const triggerDownload = (file: Blob, index: number, socketId: string) => {
    if (file) {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileNames.current[socketId][index] || "unknown";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setCompleteFiles((prevFiles) => ({
        ...prevFiles,
        [socketId]: prevFiles[socketId].filter((_, i) => i !== index),
      }));

      fileNames.current[socketId] = fileNames.current[socketId].filter(
        (_, i) => i !== index
      );
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gray-100">
      <div className="w-full max-w-md bg-white shadow-lg rounded-lg p-6 border border-gray-200">
        <h2 className="text-2xl font-bold mb-4 text-gray-800">File Transfer</h2>
        <input
          type="file"
          ref={fileInputRef}
          className="w-full mb-4 p-2 border border-gray-300 rounded-md shadow-sm text-gray-700 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Choose a file"
        />
        <div className="flex gap-4 flex-wrap justify-center">
          <button
            onClick={handleFileUpload}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 transition duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Send File
          </button>
          {Object.entries(completeFiles).map(([socketId, files]) =>
            files.map((file, index) => {
              return (
                <button
                  key={`${socketId}-${index}`}
                  onClick={() => triggerDownload(file, index, socketId)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg shadow-md hover:bg-green-700 transition duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  {fileNames.current[socketId][index] || "Unknown File"}
                </button>
              );
            })
          )}
        </div>
      </div>
      Sent : {sendingprogress}
      <br />
      Received : {receivingprogress}
    </div>
  );
};

const FileSharing = () => (
  <Suspense fallback={<div>Loading...</div>}>
    <File />
  </Suspense>
);

export default FileSharing;
