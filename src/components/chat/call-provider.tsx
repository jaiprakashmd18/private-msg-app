"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Phone, Video } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { useChat } from "./chat-provider";
import { DirectCall, type Call, type CallMode, type Signal } from "@/lib/direct-call";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const Context = createContext<((chat: string, peer: string, mode: CallMode) => void) | null>(null);

function Media({ stream, local, video }: { stream: MediaStream; local?: boolean; video: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    return () => { element.srcObject = null; };
  }, [stream]);
  return <video ref={ref} playsInline autoPlay muted={local} controls={!local} aria-label={local ? "Your preview" : "Other participant"}
    className={video ? "max-h-[32dvh] w-full rounded-xl bg-black" : "h-12 w-full"} />;
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { supabase, access } = useApp();
  const { getConversation } = useChat();
  const [call, setCall] = useState<Call | null>(null);
  const [ready, setReady] = useState(false);
  const controller = useRef<DirectCall | null>(null);
  useEffect(() => {
    const session = new DirectCall(async (c, event, data = "") => {
      const { error } = await supabase.rpc("signal_direct_call", {
        p_chat: c.chat, p_call: c.id, p_event: event, p_data: data,
      });
      if (error) throw new Error("Call signaling is unavailable.");
    }, setCall, message => toast.error(message));
    controller.current = session;
    const channel = supabase.channel(`calls:${access.user_id}`, { config: { private: true } })
      .on("broadcast", { event: "signal" }, ({ payload }) => { void session.receive(payload as Signal); })
      .subscribe(status => setReady(status === "SUBSCRIBED"));
    const leave = () => session.end();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      session.end();
      controller.current = null;
      void supabase.removeChannel(channel);
    };
  }, [supabase, access.user_id]);
  const summary = call && getConversation(call.chat);
  const name = summary?.other_display_name || summary?.other_email || "your chat contact";
  const audio = call?.local?.getAudioTracks()[0];
  const camera = call?.local?.getVideoTracks()[0];
  return <Context.Provider value={ready && !call ? (chat, peer, mode) => { void controller.current?.start(chat, peer, mode); } : null}>
    {children}
    <Dialog open={!!call} onOpenChange={open => { if (!open) controller.current?.end(); }}>
      {call && <DialogContent>
        <DialogTitle>{call.mode === "video" ? "Video" : "Voice"} call with {name}</DialogTitle>
        <DialogDescription aria-live="polite">{{ incoming: "Incoming call", ringing: "Calling…", connecting: "Connecting…", connected: "Connected" }[call.phase]}</DialogDescription>
        {call.remote && <Media stream={call.remote} video={call.mode === "video"} />}
        {camera && call.local && <Media stream={call.local} local video />}
        <div className="flex flex-wrap gap-2">
          {call.phase === "incoming" && <Button onClick={() => void controller.current?.accept()}>Answer</Button>}
          {audio && <Button variant="outline" onClick={() => controller.current?.toggle("audio")}>{audio.enabled ? "Mute" : "Unmute"}</Button>}
          {camera && <Button variant="outline" onClick={() => controller.current?.toggle("video")}>{camera.enabled ? "Camera off" : "Camera on"}</Button>}
          <Button variant="destructive" onClick={() => controller.current?.end()}>{call.phase === "incoming" ? "Decline" : "End call"}</Button>
        </div>
      </DialogContent>}
    </Dialog>
  </Context.Provider>;
}

export function CallButtons({ chat, peer }: { chat: string; peer: string }) {
  const start = useContext(Context);
  return <div className="flex items-center gap-1">
    {(["voice", "video"] as const).map(mode => <Button key={mode} variant="ghost" size="icon-sm"
      disabled={!start} aria-label={`Start ${mode} call`} title={`Start ${mode} call`}
      onClick={() => start?.(chat, peer, mode)}>{mode === "voice" ? <Phone /> : <Video />}</Button>)}
  </div>;
}
