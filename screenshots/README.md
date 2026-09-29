# Lab 7 screenshots

This folder is for genuine evidence captured after running the application.
No Postman or cloud screenshots are included yet because the Atlas-backed
services and Render deployment have not been run from this workspace.

Add these captures after completing the corresponding steps:

1. `gateway-health.png` — Postman `GET /health` response.
2. `gateway-users.png` — successful request through `/users`.
3. `gateway-products.png` — successful request through `/products`.
4. `gateway-orders.png` — successful request through `/orders`.
5. `gateway-unavailable-service.png` — gateway 502/503 after stopping a backend.
6. `render-deployment.png` — Render dashboard showing deployed services.
7. `public-gateway-tests.png` — Postman requests using the public gateway URL.

Use the imported collection at `../postman/Lab7.postman_collection.json`.
Set its `baseUrl` to the local gateway or the deployed public gateway before
capturing the matching requests. Do not include connection strings or
passwords in screenshots.
