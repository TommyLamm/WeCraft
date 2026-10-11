// Hand-written subset of the Playroom SDK 1.1.0 surface used this phase.
// Field names match the SDK verbatim.
export interface PlayroomReady {
  available: boolean;
  progressAvailable: boolean;
  mode: 'authenticated' | 'guest' | 'preview' | 'standalone';
  sdkVersion: string;
  protocolVersion: number;
  capabilities: string[];
}

export interface PlayroomProgress {
  data: unknown;
  revision: number;
  formatVersion: number;
  gameVersion: string;
  updatedAt: string;
}

export interface PlayroomModule {
  ready(): Promise<PlayroomReady>;
  loadProgress(): Promise<PlayroomProgress | null>;
  saveProgress(input: {
    data: unknown;
    revision: number;
    formatVersion: number;
    requestId?: string;
  }): Promise<(PlayroomProgress & { saved: true }) | null>;
}
