import { createServer, type Server } from 'node:http';

export interface FakeRegistryOptions {
    /** What `GET /tencil/latest` answers; unset answers 404, like an unpublished package. */
    latest?: string;
    port?: number;
}

/**
 * A stand-in for the npm registry that only knows Tencil's `latest` tag.
 * Anything else, such as npm fetching the package to install it, gets a 404.
 */
export class FakeRegistry {
    /** Change it to publish a new version. */
    latest: string | undefined;
    /** Paths asked for, oldest first. */
    readonly requests: string[] = [];
    readonly #http: Server;
    #port = 0;

    private constructor(options: FakeRegistryOptions) {
        this.latest = options.latest;
        this.#http = createServer((request, response) => {
            const path = new URL(request.url ?? '/', 'http://localhost').pathname;
            this.requests.push(path);
            if (path === '/tencil/latest' && this.latest) {
                response.writeHead(200, { 'content-type': 'application/json' });
                return void response.end(JSON.stringify({ name: 'tencil', version: this.latest }));
            }
            response.writeHead(404, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'Not found' }));
        });
    }

    static async start(options: FakeRegistryOptions = {}): Promise<FakeRegistry> {
        const registry = new FakeRegistry(options);
        await new Promise<void>(resolve =>
            registry.#http.listen(options.port ?? 0, '127.0.0.1', resolve),
        );
        const address = registry.#http.address();
        registry.#port = typeof address === 'object' && address ? address.port : 0;
        return registry;
    }

    get url(): string {
        return `http://127.0.0.1:${this.#port}`;
    }

    close(): Promise<void> {
        return new Promise(resolve => this.#http.close(() => resolve()));
    }
}
