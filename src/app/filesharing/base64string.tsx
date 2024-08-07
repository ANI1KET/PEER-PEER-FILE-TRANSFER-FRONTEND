"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import SocketIO, { disconnectSocket, socketIo } from "@/app/utils/socketIo";
import { ConnectedUser, UserMessage } from "@/app/utils/types";

const StreamContent = () => {
  const router = useRouter();
  const userName = useSearchParams().get("username");
  const meetingId = useSearchParams().get("meetingId");

  if (!userName) {
    router.back();
  }

  const [remoteUsers, setRemoteUsers] = useState<ConnectedUser[]>([]);

  const RtcPeerConnection = useRef<{
    [key: string]: RTCPeerConnection | null;
  }>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const remoteData = useRef<RTCDataChannel | null>(null);

  const fileBuffer = useRef<string[]>([]);
  const fileSize = useRef<number>(0);
  const receivedSize = useRef<number>(0);
  const fileName = useRef<string>("received-file");
  const mimeType = useRef<string>("application/octet-stream");

  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    const createConnection = async (socketId: string) => {
      const rtcPeerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun.l.google.com:5349" },
          { urls: "stun:stun1.l.google.com:3478" },
        ],
      });

      rtcPeerConnection.onnegotiationneeded = async function (event) {
        if (RtcPeerConnection.current[socketId]) {
          const offer = await RtcPeerConnection.current[
            socketId
          ]?.createOffer();
          await RtcPeerConnection.current[socketId]?.setLocalDescription(offer);
          socketIo?.emit("SDPSetUp", {
            message: JSON.stringify({
              offer: offer,
              // offer: RtcPeerConnection.current[socketId]?.localDescription,
            }),
            socketId,
          });
        }
      };

      rtcPeerConnection.onicecandidate = function (event) {
        if (event.candidate) {
          socketIo?.emit("SDPSetUp", {
            message: JSON.stringify({ iceCandidate: event.candidate }),
            socketId,
          });
        }
      };

      rtcPeerConnection.ontrack = function (event) {
        console.log("1");
      };

      remoteData.current = rtcPeerConnection.createDataChannel("myDataChannel");
      remoteData.current.onopen = () => {
        console.log("Data channel is open");
      };
      // remoteData.current.onmessage = (event) => {
      //   console.log("Received data: ", event.data);
      // };
      remoteData.current.onclose = () => {
        console.log("Data channel is closed");
      };
      rtcPeerConnection.ondatachannel = (event) => {
        const remoteChannel = event.channel;
        remoteChannel.onmessage = (event) => {
          handleIncomingMessage(event.data);
        };
      };

      RtcPeerConnection.current[socketId] = rtcPeerConnection;
    };

    if (!socketIo && userName && meetingId) {
      SocketIO(`${process.env.NEXT_PUBLIC_BASE_URL}`, userName, meetingId);
    }

    socketIo?.on("connect", async () => {
      console.log("Connected to Socket.IO server ", socketIo?.id);
    });

    socketIo?.on("Notify_User", async (ConnectedUsers: ConnectedUser) => {
      setRemoteUsers([...remoteUsers, ConnectedUsers]);
    });

    socketIo?.on("Connected_User", async (ConnectedUsers: ConnectedUser[]) => {
      setRemoteUsers([...remoteUsers, ...ConnectedUsers]);

      ConnectedUsers.forEach(async (user) => {
        await createConnection(user.socketId);
      });
    });

    socketIo?.on(
      "SDPSetUp",
      async ({ message, from }: { message: string; from: string }) => {
        const userMessage: UserMessage = JSON.parse(message);

        switch (Object.keys(userMessage)[0]) {
          case "iceCandidate":
            if (!RtcPeerConnection.current[from]) {
              await createConnection(from);
            }
            try {
              await RtcPeerConnection.current[from]?.addIceCandidate(
                new RTCIceCandidate(userMessage.iceCandidate)
              );
            } catch (error) {
              console.log(error);
            }
            break;
          case "offer":
            if (!RtcPeerConnection.current[from]) {
              await createConnection(from);
            }
            try {
              await RtcPeerConnection.current[from]?.setRemoteDescription(
                new RTCSessionDescription(userMessage.offer)
              );
              const answer = await RtcPeerConnection.current[
                from
              ]?.createAnswer();
              await RtcPeerConnection.current[from]?.setLocalDescription(
                answer
              );

              socketIo?.emit("SDPSetUp", {
                message: JSON.stringify({ answer: answer }),
                socketId: from,
              });
            } catch (error) {
              console.error(
                "Error setting remote description or creating answer:",
                error
              );
            }
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

      setRemoteUsers((prevUsers) =>
        prevUsers.filter((user) => user.socketId !== socketId)
      );
    });
    return () => {
      socketIo?.off("connect");
      socketIo?.off("SDPSetUp");
      socketIo?.off("Notify_User");
      socketIo?.off("Connected_Users");
      socketIo?.off("Notify_User_Disconnect");
    };
  }, [RtcPeerConnection, meetingId, remoteUsers, userName]);

  useEffect(() => {
    return () => {
      disconnectSocket();
    };
  }, []);

  const sendFile = () => {
    const file = fileInputRef.current?.files?.[0];
    if (file && remoteData.current) {
      const reader = new FileReader();
      const CHUNK_SIZE = 16384;

      let offset = 0;

      reader.onload = () => {
        if (typeof reader.result === "string") {
          const base64String = reader.result;
          while (offset < base64String.length) {
            const chunk = base64String.slice(offset, offset + CHUNK_SIZE);
            remoteData.current?.send(chunk);
            offset += CHUNK_SIZE;
          }
          remoteData.current?.send("EOF");
        } else {
          console.error("FileReader result is not a base64 string");
        }
      };

      reader.onerror = (error) => {
        console.error("Error reading file:", error);
      };

      reader.readAsDataURL(file);
    }
  };

  const handleIncomingMessage = (data: any) => {
    if (typeof data === "string") {
      if (data === "EOF") {
        const receivedData = fileBuffer.current.join("");
        processReceivedFile(receivedData);
      } else {
        try {
          const metadata = JSON.parse(data);
          if (metadata.type === "metadata") {
            fileName.current = metadata.name;
            mimeType.current = metadata.mimeType;
            fileSize.current = metadata.size;
            receivedSize.current = 0;
            fileBuffer.current = [];
          } else {
            console.error("Unexpected metadata format");
          }
        } catch (error) {
          fileBuffer.current.push(data);
          receivedSize.current += data.length;
        }
      }
    } else {
      console.error("Unexpected message type");
    }
  };

  const processReceivedFile = (base64String: string) => {
    const url = base64String;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.current;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex justify-center items-center p-4 min-h-screen">
      <input type="file" ref={fileInputRef} />
      <button onClick={sendFile}>Send File</button>
      {/* {downloadUrl && (
        <div>
          <h2>Received File</h2>
          <a href={downloadUrl} download="received-file">
            Download File
          </a>
        </div>
      )} */}
    </div>
  );
};

const Stream = () => (
  <Suspense fallback={<div>Loading...</div>}>
    <StreamContent />
  </Suspense>
);

export default Stream;
