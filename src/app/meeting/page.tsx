"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef } from "react";

const MeetingContent = () => {
  const router = useRouter();
  const meetingId = useSearchParams().get("meetingId");
  const usernameRef = useRef<HTMLInputElement>(null);

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const username = usernameRef.current?.value.trim();
    if (!username) {
      return;
    }
    router.push(`/filesharing?username=${username}&meetingId=${meetingId}`);
  };
  return (
    <div className="flex justify-center items-center min-h-screen">
      <div className="bg-gray-800 p-6 rounded-lg shadow-md">
        <h5 className="text-white text-lg font-bold mb-4">Username</h5>
        <form
          onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <div className="mb-4">
            <input
              type="text"
              placeholder="Username"
              className="p-3 border-b-2 border-gray-300 focus:border-teal-500 outline-none w-full"
              ref={usernameRef}
            />
            <input
              type="hidden"
              value={meetingId ?? ""}
              onKeyDown={handleKeyPress}
            />
          </div>
          <button
            type="submit"
            className="bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-md transition duration-300 block text-center"
            id="loginbtn"
          >
            Start Stream
          </button>
        </form>
      </div>
    </div>
  );
};

const Meeting = () => (
  <Suspense fallback={<div>Loading...</div>}>
    <MeetingContent />
  </Suspense>
);

export default Meeting;
