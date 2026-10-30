import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const frontend = fileURLToPath(
  new URL('../../OCEANPULSE-FRONTEND-HACKATHON/', import.meta.url),
);

// Runs the checked-in mobile logic over real HTTP/WebSockets. Native platform services
// are doubles; this harness does not claim a device, SecureStore or GPS runtime check.
export function mobileClient(baseUrl) {
  if (!existsSync(join(frontend, 'node_modules/typescript'))) {
    throw new Error(
      'Install the sibling mobile checkout dependencies before running journey tests.',
    );
  }
  const requireFrontend = createRequire(join(frontend, 'package.json'));
  const ts = requireFrontend('typescript');
  const React = requireFrontend('react');
  const renderer = requireFrontend('react-test-renderer');
  const storage = new Map();
  const secure = new Map();
  const listeners = new Set();
  const cache = new Map();
  const transports = new Set();
  const faults = { dropNextSendReply: false };
  const axios = requireFrontend('axios');
  const nativeAxios = axios.create.bind(axios);
  const axiosWithFaults = Object.create(axios);
  axiosWithFaults.create = (config) => {
    const instance = nativeAxios(config);
    instance.interceptors.response.use((response) => {
      if (faults.dropNextSendReply && response.config.url === 'messages/send') {
        faults.dropNextSendReply = false;
        throw new Error(
          'Simulated lost mobile acknowledgement after server commit',
        );
      }
      return response;
    });
    return instance;
  };
  // Preserve the module's default-import shape while keeping fault injection local to this client.
  axiosWithFaults.default = axiosWithFaults;

  class MobileWebSocket extends WebSocket {
    constructor(url) {
      super(url);
      transports.add(this);
      this.once('close', () => transports.delete(this));
    }
  }

  const dependencies = {
    react: React,
    'react-native': {
      Platform: { OS: 'android' },
      AppState: {
        currentState: 'active',
        addEventListener: (event, listener) => {
          listeners.add(listener);
          return { remove: () => listeners.delete(listener) };
        },
      },
    },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => {
        storage.set(key, value);
      },
      removeItem: async (key) => {
        storage.delete(key);
      },
      multiSet: async (entries) =>
        entries.forEach(([key, value]) => storage.set(key, value)),
      multiRemove: async (keys) => keys.forEach((key) => storage.delete(key)),
    },
    'expo-secure-store': {
      getItemAsync: async (key) => secure.get(key) ?? null,
      setItemAsync: async (key, value) => {
        secure.set(key, value);
      },
      deleteItemAsync: async (key) => {
        secure.delete(key);
      },
    },
    'expo-crypto': { randomUUID },
    'expo-location': {
      Accuracy: { High: 4 },
      requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
      getCurrentPositionAsync: async () => ({
        coords: { latitude: 0, longitude: 0 },
      }),
    },
    axios: axiosWithFaults,
  };

  function load(filename) {
    let path = resolve(frontend, filename);
    path = [path, `${path}.ts`, `${path}.tsx`, join(path, 'index.ts')].find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    );
    if (!path || !path.startsWith(frontend))
      throw new Error('Cannot resolve mobile source module');
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} };
    cache.set(path, module);
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
      fileName: path,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(
      compiled,
      {
        exports: module.exports,
        module,
        console,
        URL,
        AbortController,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        WebSocket: MobileWebSocket,
        process: { env: { EXPO_PUBLIC_API_URL: baseUrl } },
        require: (name) => {
          if (Object.hasOwn(dependencies, name)) return dependencies[name];
          if (name.startsWith('@/')) return load(name.slice(2));
          if (name.startsWith('.')) return load(resolve(dirname(path), name));
          return requireFrontend(name);
        },
      },
      { filename: path },
    );
    return module.exports;
  }

  const api = load('utils/api').default;
  const session = load('utils/session');
  const store = load('store').default;
  const auth = load('store/authSlice');
  async function signIn(token, user) {
    await session.saveSession(token, user);
    store.dispatch(auth.setUserId(user.userId));
  }
  async function mount(filename, initialProps) {
    const hook = load(filename).default;
    let props = initialProps;
    let snapshot;
    let root;
    function Harness() {
      snapshot = hook(...props);
      return null;
    }
    await renderer.act(async () => {
      root = renderer.create(React.createElement(Harness));
    });
    return {
      get value() {
        return snapshot;
      },
      act: renderer.act,
      async update(next) {
        props = next;
        await renderer.act(async () =>
          root.update(React.createElement(Harness)),
        );
      },
      async close() {
        await renderer.act(async () => root.unmount());
      },
    };
  }

  return {
    api,
    session,
    store,
    signIn,
    mount,
    faults,
    load,
    disconnectSockets() {
      for (const socket of transports) socket.terminate();
    },
    close() {
      for (const socket of transports) socket.terminate();
    },
  };
}
