# LLM Router Dashboard

Vanilla JavaScript/HTML/CSS dashboard for monitoring and testing the Free LLM Router Microservice.

## Features

- **Real-time Monitoring**: Auto-refreshing metrics every 5 seconds
- **Model State Tracking**: View all models and their circuit breaker states
- **API Testing**: Test LLM requests directly from the browser
- **Rate Limit Monitoring**: Track rate limiting status across providers
- **Zero Dependencies**: Pure JavaScript, no frameworks required

## Access

The dashboard is served at the root path `/` of the microservice.

Default URL: `http://localhost:8080/`

## Tabs

### 📊 Overview
- Total requests (successful/failed)
- Average latency across all models
- Fallback usage statistics
- Active connections
- Models availability status

### 🎯 Models State
- View all configured models
- Circuit breaker states (CLOSED, OPEN, HALF_OPEN, PERMANENTLY_UNAVAILABLE)
- Per-model statistics:
  - Total requests
  - Success/Error counts
  - Average latency
  - Active requests
  - Success rate

### 🧪 API Tester
- Send test requests to the microservice
- Configure model, temperature, max tokens
- View formatted responses with metadata
- Test both direct model selection and smart routing (use "auto")

### ⏱️ Rate Limits
- Global rate limit status
- Per-provider rate limits
- Current usage vs limits for minute/hour windows

## Configuration

The dashboard automatically detects the API base path from the server configuration.
It communicates with the microservice through the Admin API endpoints:

- `/api/v1/health` - Service health check
- `/api/v1/admin/metrics` - Overall metrics
- `/api/v1/admin/state` - Model states
- `/api/v1/admin/rate-limits` - Rate limiting status
- `/api/v1/chat/completions` - LLM completion endpoint (for testing)

## Development

The dashboard consists of three files:
- `index.html` - Structure and markup
- `styles.css` - Modern dark theme styling
- `app.js` - Dashboard logic and API communication

All files are served statically from the `/public` directory by the `DashboardController`.

## Design

- Modern dark mode with glassmorphism effects
- Smooth animations and micro-interactions
- Responsive design for mobile and desktop
- Color-coded status indicators
- Real-time auto-refresh
