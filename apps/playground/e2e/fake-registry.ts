import { FakeRegistry } from '@tencildev/testing';

/**
 * Fake npm registry for the browser tests: it says a newer Tencil is out, and
 * has no package to install, so an update from the overlay fails like it would
 * offline.
 */
const registry = await FakeRegistry.start({
    port: Number(process.env.FAKE_REGISTRY_PORT ?? 47392),
    latest: '99.0.0',
});
console.log(`Fake registry listening on ${registry.url}`);
process.on('SIGTERM', () => void registry.close().then(() => process.exit(0)));
