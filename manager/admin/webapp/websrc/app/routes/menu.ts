const DASHBOARD = {
  text: '总览',
  translate: 'sidebar.nav.DASHBOARD',
  link: '/dashboard',
  icon: 'performance',
};
const NETWORK_ACTIVITY = {
  text: '网络活动',
  translate: 'sidebar.nav.NETWORK_ACTIVITY',
  link: '/graph',
  icon: 'neural_network',
};
const MICROSEGX = {
  text: 'MicroSegX',
  translate: 'sidebar.nav.MICROSEGX',
  icon: 'security',
  submenu: [
    {
      text: '自动策略',
      translate: 'sidebar.nav.AUTO_POLICY',
      link: '/microsegx/auto-policy',
    },
    {
      text: '端口暴露与零信任',
      translate: 'sidebar.nav.PORT_EXPOSURE',
      link: '/microsegx/port-exposure',
    },
  ],
};
const ASSETS = {
  text: '资产',
  translate: 'sidebar.nav.RESOURCE',
  icon: 'products',
  submenu: [
    {
      text: '平台',
      translate: 'scan.PLATFORM',
      link: '/platforms',
    },
    {
      text: '命名空间',
      translate: 'sidebar.nav.NAMESPACES',
      link: '/domains',
    },
    {
      text: '节点',
      translate: 'sidebar.nav.NODES',
      link: '/hosts',
    },
    {
      text: '容器',
      translate: 'sidebar.nav.CONTAINERS',
      link: '/workloads',
    },
    {
      text: '镜像仓',
      translate: 'sidebar.nav.REG_SCAN',
      link: '/regScan',
    },
    {
      text: '系统组件',
      translate: 'sidebar.nav.SYSTEM_COMPONENTS',
      link: '/controllers',
    },
  ],
};
const POLICY = {
  text: '策略',
  translate: 'sidebar.nav.SECURITY',
  icon: 'policy',
  submenu: [
    {
      text: '准入控制',
      translate: 'sidebar.nav.ADMISSION_CONTROL',
      link: '/admission-control',
    },
    {
      text: '分组',
      translate: 'sidebar.nav.GROUP',
      link: '/group',
    },
    {
      text: '网络规则',
      translate: 'sidebar.nav.POLICY',
      link: '/policy',
    },
    {
      text: '响应规则',
      translate: 'sidebar.nav.RESPONSE_POLICY',
      link: '/response-policy',
    },
    {
      text: 'WAF 传感器',
      translate: 'sidebar.nav.WAF_SENSORS',
      link: '/waf-sensors',
    },
  ],
};
const SECURITY_RISKS = {
  text: '风险治理',
  translate: 'sidebar.nav.RISK',
  icon: 'critical_bug',
  submenu: [
    {
      text: '漏洞',
      translate: 'sidebar.nav.SCAN',
      link: '/scan',
    },
    {
      text: '漏洞档案',
      translate: 'cveProfile.TITLE',
      link: '/cveProfile',
    },
    {
      text: '合规',
      translate: 'sidebar.nav.BENCH',
      link: '/bench',
    },
    {
      text: '合规档案',
      translate: 'cis.COMPLIANCE_PROFILE',
      link: '/cisProfile',
    },
  ],
};
const NOTIFICATIONS = {
  text: '通知',
  translate: 'sidebar.nav.NOTIFICATIONS',
  icon: 'notifications_none',
  submenu: [
    {
      text: '安全事件',
      translate: 'sidebar.nav.SECURITY_EVENT',
      link: '/security-event',
    },
    {
      text: '风险报告',
      translate: 'sidebar.nav.AUDIT',
      link: '/audit',
    },
    {
      text: '事件',
      translate: 'sidebar.nav.EVENT',
      link: '/event',
    },
  ],
};
const SETTINGS = {
  text: '设置',
  translate: 'sidebar.nav.SETTING',
  link: '/settings',
  icon: 'settings_suggest',
};

export const menu = [
  DASHBOARD,
  NETWORK_ACTIVITY,
  MICROSEGX,
  ASSETS,
  POLICY,
  NOTIFICATIONS,
  SETTINGS,
];
