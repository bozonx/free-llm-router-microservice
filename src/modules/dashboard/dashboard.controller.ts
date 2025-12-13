import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply } from 'fastify';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import type { AppConfig } from '../../config/app.config.js';

/**
 * Controller for serving static UI dashboard files
 * Serves the monitoring dashboard from the /public directory
 */
@Controller()
export class DashboardController {
    private readonly publicPath: string;
    private readonly apiBasePath: string;

    constructor(private readonly configService: ConfigService) {
        // Public directory is at the root of the project
        this.publicPath = join(process.cwd(), 'public');

        // Get API base path from config
        const appConfig = this.configService.get<AppConfig>('app');
        this.apiBasePath = `/${appConfig?.apiBasePath || 'api'}/v1`;
    }

    /**
     * Serve the main dashboard HTML at the root path
     * GET /
     */
    @Get()
    public serveDashboard(@Res() reply: FastifyReply): void {
        const filePath = join(this.publicPath, 'index.html');

        if (!existsSync(filePath)) {
            reply.code(404).send({ error: 'File not found' });
            return;
        }

        try {
            let content = readFileSync(filePath, 'utf-8');

            // Inject API base path into the meta tag
            content = content.replace(
                '<meta name="api-base-path" content="">',
                `<meta name="api-base-path" content="${this.apiBasePath}">`,
            );

            reply.header('Content-Type', 'text/html; charset=utf-8').send(content);
        } catch (error) {
            reply.code(500).send({ error: 'Failed to read file' });
        }
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
