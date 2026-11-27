export type CallMode = "voice" | "video";
type Event = CallMode | "ready" | "offer" | "answer" | "end";
export type Signal = { id: string; chat: string; sender: string; event: Event; data: string };
export type Call = {
  id: string; chat: string; peer: string; mode: CallMode;
  phase: "incoming" | "ringing" | "connecting" | "connected";
  outgoing: boolean; local?: MediaStream; remote?: MediaStream;
};

export class DirectCall {
  current: Call | null = null;
  private pc?: RTCPeerConnection;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private send: (call: Call, event: Event, data?: string) => Promise<void>,
    private update: (call: Call | null) => void,
    private notify: (message: string) => void,
  ) {}

  private render() { this.update(this.current && { ...this.current }); }

  private begin(call: Call) {
    this.current = call;
    this.render();
    this.timer = setTimeout(() => {
      this.notify("The call timed out.");
      this.end();
    }, 60000);
  }

  toggle(kind: "audio" | "video") {
    const track = this.current?.local?.getTracks().find(track => track.kind === kind);
    if (track) { track.enabled = !track.enabled; this.render(); }
  }

  end(signal = true) {
    const call = this.current;
    if (!call) return;
    this.current = null;
    clearTimeout(this.timer);
    this.pc?.close();
    this.pc = undefined;
    call.local?.getTracks().forEach(track => track.stop());
    if (signal) void this.send(call, "end").catch(() => {});
    this.render();
  }

  private fail(call: Call, error: unknown) {
    if (this.current !== call) return;
    this.notify(error instanceof Error ? error.message : "Could not connect the call.");
    this.end();
  }

  async start(chat: string, peer: string, mode: CallMode) {
    if (this.current) return;
    const call: Call = { chat, peer, mode, id: crypto.randomUUID(), outgoing: true, phase: "ringing" };
    this.begin(call);
    try {
      await this.prepare(call);
      if (this.current === call) await this.send(call, mode);
    } catch (error) { this.fail(call, error); }
  }

  async accept() {
    const call = this.current;
    if (!call || call.phase !== "incoming") return;
    call.phase = "connecting";
    this.render();
    try {
      await this.prepare(call);
      if (this.current === call) await this.send(call, "ready");
    } catch (error) { this.fail(call, error); }
  }

  private async prepare(call: Call) {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      throw new Error("Calling requires a browser with microphone access over HTTPS.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.mode === "video" });
    if (this.current !== call) { stream.getTracks().forEach(track => track.stop()); return; }
    call.local = stream;
    this.render();
    const response = await fetch("/api/calls/ice", { cache: "no-store" });
    if (!response.ok) throw new Error("Call connection settings are unavailable.");
    const config = await response.json() as RTCConfiguration;
    if (this.current !== call) return;
    const pc = this.pc = new RTCPeerConnection(config);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.ontrack = ({ streams }) => {
      if (this.current === call) { call.remote = streams[0]; this.render(); }
    };
    pc.onconnectionstatechange = () => {
      if (this.current !== call) return;
      if (pc.connectionState === "connected") {
        clearTimeout(this.timer);
        call.phase = "connected";
        this.render();
      } else if (pc.connectionState === "failed") this.fail(call, new Error("Call connection lost."));
    };
  }

  async receive(signal: Signal) {
    const { id, chat, sender, event, data } = signal;
    if (event === "voice" || event === "video") {
      const incoming: Call = { id, chat, peer: sender, mode: event, outgoing: false, phase: "incoming" };
      if (!this.current) this.begin(incoming);
      else if (this.current.id !== id) await this.send(incoming, "end").catch(() => {});
      return;
    }
    const call = this.current;
    if (!call || call.id !== id || call.chat !== chat || call.peer !== sender) return;
    if (event === "end") { this.end(false); return; }
    const pc = this.pc;
    if (!pc) return;
    try {
      if (event === "ready" && call.outgoing && call.phase === "ringing") {
        call.phase = "connecting";
        this.render();
        await this.describe(call, pc, await pc.createOffer());
      } else if (event === "offer" && !call.outgoing && call.phase === "connecting") {
        await pc.setRemoteDescription({ type: "offer", sdp: data });
        await this.describe(call, pc, await pc.createAnswer());
      } else if (event === "answer" && call.outgoing && pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription({ type: "answer", sdp: data });
      }
    } catch (error) { this.fail(call, error); }
  }

  private async describe(call: Call, pc: RTCPeerConnection, description: RTCSessionDescriptionInit) {
    await pc.setLocalDescription(description);
    if (pc.iceGatheringState !== "complete") {
      await new Promise<void>(resolve => {
        const finish = () => {
          clearTimeout(timeout);
          pc.removeEventListener("icegatheringstatechange", changed);
          resolve();
        };
        const changed = () => { if (pc.iceGatheringState === "complete") finish(); };
        const timeout = setTimeout(finish, 8000);
        pc.addEventListener("icegatheringstatechange", changed);
        changed();
      });
    }
    if (this.current === call && pc.localDescription) {
      if (!/^a=candidate:/m.test(pc.localDescription.sdp)) {
        throw new Error("No network path for this call. Try another network or check the call relay.");
      }
      await this.send(call, description.type === "offer" ? "offer" : "answer", pc.localDescription.sdp);
    }
  }
}
