export interface MicrosegxPortExposureOverview {
  managedServices: number;
  openPorts: number;
  exposedTargets: number;
  resourceCount: number;
  trafficTargets: number;
  nodes: number;
  generatedAt: string;
  scanInProgress: boolean;
}

export interface MicrosegxZitiOverview {
  available: boolean;
  defaultControllerUrl: string;
  defaultCredentialsConfigured: boolean;
  aliveRouters: number;
  deployedRouters: number;
  services: number;
  configs: number;
  identities: number;
  controllerError?: string | null;
}

export interface MicrosegxOverview {
  baseUrl: string;
  portExposure: MicrosegxPortExposureOverview;
  ziti: MicrosegxZitiOverview;
  dashboard: any;
  zitiSession: any;
  zitiOverview: any;
}
