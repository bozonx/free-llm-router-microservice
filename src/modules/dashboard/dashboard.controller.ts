import { Controller, Get, Res } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

/**
 * Controller for serving static UI dashboard files
 * Serves the monitoring dashboard from the /public directory
 */
@Controller()
export class DashboardController {
    private readonly publicPath: string;

    constructor() {
        // Public directory is at the root of the project
        this.publicPath = join(process.cwd(), 'public');
    }

    /**
     * Serve the main dashboard HTML at the root path
     * GET /
     */
    @Get()
    public serveDashboard(@Res() reply: FastifyReply): void {
        this.serveFile('index.html', reply);
    }

    /**
     * Serve CSS file
     * GET /styles.css
     */
    @Get('styles.css')
    public serveStyles(@Res() reply: FastifyReply): void {
        this.serveFile('styles.css', reply, 'text/css');
    }

    /**
     * Serve JavaScript file
     * GET /app.js
     */
    @Get('app.js')
    public serveScript(@Res() reply: FastifyReply): void {
        this.serveFile('app.js', reply, 'application/javascript');
    }

    /**
     * Helper method to serve files from the public directory
     */
    private serveFile(
        filename: string,
        reply: FastifyReply,
        contentType: string = 'text/html',
    ): void {
        const filePath = join(this.publicPath, filename);

        if (!existsSync(filePath)) {
            reply.code(404).send({ error: 'File not found' });
            return;
        }

        try {
            const content = readFileSync(filePath, 'utf-8');
            reply.header('Content-Type', `${contentType}; charset=utf-8`).send(content);
        } catch (error) {
            reply.code(500).send({ error: 'Failed to read file' });
        }
    }
}
