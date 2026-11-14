# Jimvolt Renewable Energy Marketplace

Jimvolt is a React marketplace for renewable-energy products and services, backed by an Express API and PostgreSQL. Public visitors can browse approved advertisements; guests can save a wishlist in their browser, and registered users can post listings, message and rate sellers, use an account wishlist, and manage their accounts. Administrators can review submitted advertisements.

## Requirements

- Node.js 22 or newer
- PostgreSQL 14 or newer (Aiven for PostgreSQL works, and so does any local install)

## Database setup

The API creates its tables itself at startup from `backend/config/schema.sql`. Every statement is idempotent (`CREATE ... IF NOT EXISTS`), so existing tables and rows are never dropped or rewritten, and the file is only re-applied when its contents change. The API also seeds the renewable-energy categories and promotion packages. The schema uses the `citext` extension for case-insensitive emails, usernames and slugs, so the database user needs permission to create it (Aiven's default `avnadmin` user can).

Use a dedicated application account instead of a superuser such as `postgres`. For a local database, as an administrator:

```sql
CREATE USER jimvolt_user WITH PASSWORD 'choose-a-unique-password';
CREATE DATABASE jimvolt_db OWNER jimvolt_user;
```

You can also apply `backend/config/schema.sql` yourself with `psql -f backend/config/schema.sql`.

### Aiven for PostgreSQL

1. Create an Aiven for PostgreSQL service and copy its host, port, user, password and database name from the service overview.
2. Download the CA certificate from the service page, save it as `backend/certs/ca.pem`, and set `DB_SSL_CA=certs/ca.pem`. Remote databases require it.
3. On Vercel, create a **connection pool** in the Aiven console (Pools tab) and use the pool's port and database name for `DB_PORT` and `DB_NAME`. PgBouncer shares a small number of real connections between all serverless instances, which prevents "too many connections" errors. Pool mode `transaction` is supported.
4. Each Vercel instance opens at most 2 connections by default; set `DB_CONNECTION_LIMIT` to change that.

### Moving existing MySQL data to PostgreSQL

`backend/scripts/migrateMysqlToPostgres.js` copies every table from the old MySQL database in one transaction (a failure leaves PostgreSQL untouched), converts booleans, JSON and zero dates, keeps the original ids, moves the id sequences, and checks that every row count matches. It only reads from MySQL and refuses to run on a PostgreSQL database that already has data.

```bash
cd backend
npm install --no-save mysql2           # the one-off script needs the MySQL driver
# Add the PostgreSQL settings (DB_*) and the old MySQL settings to backend/.env:
#   SOURCE_DB_HOST, SOURCE_DB_PORT, SOURCE_DB_USER, SOURCE_DB_PASSWORD, SOURCE_DB_NAME,
#   SOURCE_DB_SSL_CA (path to the Aiven MySQL CA), SOURCE_DB_TIMEZONE (default Z, meaning UTC)
node -e "require('./config/database').ensureCoreSchema().then(() => process.exit(0))"  # create the tables
node scripts/migrateMysqlToPostgres.js --dry-run   # counts rows in MySQL
node scripts/migrateMysqlToPostgres.js             # copies the data
```

Stop writes to the old site first (maintenance mode or a paused deployment) so nothing is added during the copy, then point the deployment's `DB_*` variables at PostgreSQL. Keep the MySQL database until you have checked the new site.

### Starting a fresh database (admin and demo products)

If you are not copying old data, `backend/scripts/seedDemoData.js` creates a super administrator and 12 demo products across the categories (approved, no photos, so listings show the category picture):

```bash
cd backend
node scripts/seedDemoData.js                 # admin + demo seller + demo products
node scripts/seedDemoData.js --remove-demo   # removes the demo seller and all demo products
```

`SEED_ADMIN_EMAIL` (default `admin@jimvolt.com`), `SEED_ADMIN_PHONE` and `SEED_ADMIN_PASSWORD` (at least 12 characters) are optional; without a password a random one is printed once. Running it twice is safe: an existing admin is never changed and existing demo products are skipped. The demo seller cannot sign in and is not marked verified. Sign in at `/admin/login`, then change the password and phone number in Account settings.

Configure `backend/.env`:

```env
PORT=5000
FRONTEND_URL=http://localhost:5173
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters-long
DB_HOST=localhost
DB_PORT=5432
DB_NAME=jimvolt_db
DB_USER=jimvolt_user
DB_PASSWORD=your-application-user-password
# DB_SSL_CA=certs/ca.pem        # required for any non-local database (Aiven)
# DB_CONNECTION_LIMIT=2         # per instance; defaults to 2 on Vercel and 10 elsewhere

# Optional SMTP settings for real password-reset and email-verification messages.
EMAIL_HOST=
EMAIL_PORT=587
EMAIL_USER=
EMAIL_PASS=
EMAIL_FROM=Jimvolt <no-reply@example.com>
BACHS_API_KEY=sk_sandbox_your_bachs_sandbox_key
```

Generate a JWT secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` and place the result in `JWT_SECRET`. Keep `.env` private; `.env` files are excluded by the repository ignore rules.

If SMTP is not configured, password-reset and email-verification links are printed to the backend console for local development. Do not use the console preview in production.

## Run locally

Start the API:

```sh
cd backend
npm install
npm run dev
```

Start the React application in another terminal:

```sh
cd frontend
npm install
npm run dev
```

The frontend defaults to `http://localhost:5000/api`. To change it, set `VITE_API_URL` in the frontend environment (for example `http://localhost:5000/api`). The API CORS allow-list uses `FRONTEND_URL`.
Set `VITE_SUPPORT_EMAIL` in the frontend environment to provide the address displayed on the Contact page.

## Bachs checkout test

Set `BACHS_API_KEY` in `backend/.env` to a Bachs sandbox API key, then open `/tests/bachs`. Enter a Naira amount to create a hosted checkout and redirect to Bachs. The endpoint accepts sandbox keys only; returning to the page does not verify payment completion.

Seller promotions use Bachs hosted checkout at `/dashboard/promotions`. Configure `BACHS_API_KEY` and `BACHS_WEBHOOK_SECRET` on the backend, then register `POST /api/payments/webhook` in the Bachs developer portal for `checkout.completed`, `checkout.expired`, `collection.succeeded`, and `collection.failed`. The SDK verifies webhook signatures against the original request body; promotions are activated only after Bachs confirms a paid checkout and the stored amount and currency match. Run checkout tests with a Bachs sandbox key before switching to live credentials.

## Deploy frontend and API to Vercel

Import the repository as a Vercel project with the repository root as its Root Directory. The root `vercel.json` defines two services: `frontend` (Vite) and `backend` (Express). It routes `/api/*`, `/uploads/*`, and server-rendered SEO paths to the backend; other routes, including `/tests/bachs`, go to the frontend. The frontend service rewrites SPA paths to `index.html`, enabling direct links and browser refreshes. The backend has an internal binding to the frontend so its SEO routes can load the frontend HTML template. Browser API calls use the public same-origin `/api` path and do not need a service binding.

Configure these values in Vercel's project Environment Variables for each environment you deploy:

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` (`jimvolt_db`). Use a managed PostgreSQL server reachable from Vercel (for Aiven, the connection pool port, with `DB_SSL_CA` set), not `localhost` or a superuser account.
- `JWT_SECRET` (at least 32 characters), `FRONTEND_URL`, and `PUBLIC_SITE_URL` using your deployed site URL. Vercel's deployment and production domains are also allowed automatically by the API CORS policy.
- `BACHS_API_KEY` and `BACHS_WEBHOOK_SECRET` to enable Bachs promotion checkout and verified webhooks. Use sandbox credentials during testing and keep provider secrets server-side.
- Configure `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, and `EMAIL_FROM` to send account emails.
- Configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` for message image attachments. Set `VITE_SUPPORT_EMAIL` if the Contact page should show a support address.

Do not set `JIMVOLT_FRONTEND_URL` manually; Vercel injects it through the backend-to-frontend service binding. Vercel Functions do not provide persistent local disk or long-lived WebSocket connections. Product image files and seller verification documents currently use local disk, and real-time messaging uses Socket.IO; those features need durable object storage and a separate WebSocket-capable service for production use. Configure all required environment variables before deploying; the database must already be provisioned and accessible.

## Advertisement image uploads

The authenticated `POST /api/ads` and `PUT /api/ads/:id` endpoints accept multipart form data. Product images are signature-checked JPEG, PNG, or WebP files (up to 5 MB each and 10 images by default), stored with generated filenames under `backend/uploads/products`, and served through `/uploads/products/`. The existing `product_images` table stores the resulting paths alongside existing HTTP(S) image URLs; no schema migration is required.

Optional backend environment variables configure limits:

```env
PRODUCT_IMAGE_MAX_FILE_SIZE_MB=5
PRODUCT_IMAGE_MAX_COUNT=10
```

In production, keep `backend/uploads` on persistent storage and include it in backups. If the frontend and API are on different hosts, set `VITE_API_URL` to the public API URL so the frontend can resolve uploaded image paths to the API host.

## Profile picture uploads

The authenticated `PUT /api/users/profile` endpoint accepts the existing profile fields as multipart form data and an optional `profileImage` file. JPG/JPEG, PNG, and WebP files are checked against their extension, MIME type, and file signature, limited to 5 MB, and stored using unique server-generated identifiers. When Cloudinary credentials are configured, profile pictures reuse the existing Cloudinary account in `jimvolt/profiles`; otherwise, images are stored under `backend/uploads/profiles` and served through `/uploads/profiles/`. The existing `users.profile_image` field stores the resulting URL/path. `DELETE /api/users/profile/image` removes the signed-in user's picture; no database migration is required.

Local profile image storage requires durable backend storage in production. Vercel Functions do not persist local files between invocations, so configure Cloudinary (the existing `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`) or another persistent storage service when deploying to Vercel.

## Main routes

- `/` — marketplace home
- `/ads` — searchable, filterable advertisements
- `/ads/:id` — product details and seller contact
- `/post-ad` — submit an advertisement for moderation
- `/dashboard` — user advertisements and database-backed statistics
- `/saved`, `/favourites`, `/recently-viewed`, and `/messages` — saved products, browsing history, and messaging
- `/profile` and `/account-settings` — profile and account management
- `/admin` — administrator advertisement review
- `/register`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email` — account flows
- `/tests/bachs` — sandbox-only hosted checkout test page

## SEO and search visibility

Website metadata, canonical URLs, robots rules, and the XML sitemap are served from the backend for public marketplace pages. The API exposes `robots.txt` and `sitemap.xml` at the site root, and the SEO route layer marks private pages such as `/admin`, `/dashboard`, `/messages`, `/login`, and `/register` as `noindex,nofollow` while allowing public listings to be indexed when they are approved and publicly accessible.

Set a production `PUBLIC_SITE_URL` in the backend environment so canonical URLs, OG tags, and sitemap output point to the live domain rather than `http://localhost:5173` during deployment. Example:

```env
PUBLIC_SITE_URL=https://www.jimvolt.com
```

## Secure first administrator setup

The platform supports `admin` and `super_admin` roles. Create a super administrator from the backend using the interactive command below; the password is entered without terminal echo. Do not create a public route that allows users to self-promote.

```sh
cd backend
npm run create-super-admin
```

The command asks for the administrator's name, email, Nigerian phone number, and password. It validates the details, hashes the password with bcrypt, rejects duplicate email or phone accounts, and creates the user in the existing `users` table. Keep administrator credentials out of command-line arguments and source control.

## Admin API surface

Open `/admin/login` to sign in with an active account whose database role is `admin` or `super_admin`. On success, the existing Jimvolt JWT/session mechanism is used and the administrator is sent to `/admin/dashboard`. Check “Remember me” to persist the session in local storage; otherwise it is limited to the browser session. The administrator navigation contains the overview, advertisements, users, sellers, verification, categories, reports, payments, analytics, and settings sections. Logging out clears both persistent and session credentials.

The login endpoint is `POST /api/admin/login`; it checks credentials against the existing `users` table, uses bcrypt password verification, limits repeated attempts, and rejects non-administrator roles. All other administrator endpoints require a valid JWT and server-side role authorization; frontend route guards are only an additional UX layer.

If there is no super administrator account, run the existing interactive initializer from the backend directory. It asks for credentials without echoing the password, hashes it with bcrypt, and refuses duplicate email/phone accounts:

```sh
cd backend
npm run create-super-admin
```

After creation, sign in at `/admin/login`. Do not put an administrator password in a command argument or source file.

- `GET /api/admin/dashboard`
- `GET /api/admin/analytics`
- `GET /api/admin/ads`
- `PUT /api/admin/ads/:id/approve`
- `PUT /api/admin/ads/:id/reject`
- `PUT /api/admin/ads/:id/suspend`
- `PUT /api/admin/ads/:id/feature`
- `DELETE /api/admin/ads/:id`
- `GET /api/admin/users`
- `GET /api/admin/users/:id`
- `PUT /api/admin/users/:id/suspend`
- `PUT /api/admin/users/:id/activate`
- `GET /api/admin/sellers`
- `GET /api/admin/verifications`
- `PUT /api/admin/verifications/:id/approve`
- `PUT /api/admin/verifications/:id/reject`
- `GET /api/admin/reports`
- `PUT /api/admin/reports/:id/resolve`
- `GET /api/admin/categories`
- `POST /api/admin/categories`
- `PUT /api/admin/categories/:id`
- `DELETE /api/admin/categories/:id`
- `GET /api/admin/payments`
- `GET /api/admin/audit-logs`

## Messaging setup

The messaging system uses the existing database connection and JWT authentication. Socket.IO runs on the same backend HTTP server and authenticates each connection with the current Jimvolt bearer token. For image attachments, configure Cloudinary in `backend/.env`:

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

Keep the Cloudinary API secret only in the backend environment. Authenticated image uploads are limited to four JPEG, PNG, WebP, or GIF files per request and 5 MB per file. The database startup migration creates conversation tables, adds message metadata, and links eligible historical messages to conversations without dropping old message records.

The main messaging endpoints are `GET /api/messages/conversations`, `POST /api/messages/conversations`, `GET /api/messages/conversations/:id/messages`, `POST /api/messages/conversations/:id/messages`, `PUT /api/messages/conversations/:id/read`, `PUT /api/messages/conversations/:id/archive`, `DELETE /api/messages/conversations/:id`, `POST /api/messages/uploads`, and `POST /api/messages/conversations/:id/report`. All conversation operations enforce participant membership.

Socket.IO authenticates with `auth: { token }` and supports `conversation:join`, `conversation:leave`, `typing:start`, and `typing:stop` client events. Server events include `message:new`, `message:delivered`, `message:read`, `typing:update`, `presence:initial`, `presence:update`, and `messages:unread_count`. Conversation rooms are joined only after checking the authenticated socket user against the conversation participants table.

## Saved products and browsing history

The existing `favourites` table is extended in place: saved product snapshots allow a user's saved item to remain visible if the advertisement is later deleted. Startup migrations add the unique and foreign-key behavior needed for favorites and create `recently_viewed`, `price_history`, and `wishlist_preferences` without dropping existing records. Sellers can mark approved or paused advertisements as sold from the dashboard; reactivating a sold advertisement makes it available again and notifies its savers. Price-drop alerts can be disabled in `/saved`.

Authenticated API routes:

- `GET /api/favorites` — private, searchable, filterable, paginated saved products (`q`, `category`, `sort`, `page`, `limit`)
- `POST /api/favorites/:advertisementId`, `DELETE /api/favorites/:advertisementId`, `DELETE /api/favorites/entry/:favoriteId`, and `DELETE /api/favorites` — save or remove products; deleting by favorite ID also works for an advertisement that has already been removed
- `GET /api/favorites/count` and `GET`/`PUT /api/favorites/preferences`
- `GET /api/recently-viewed`, `POST /api/recently-viewed/:advertisementId`, `POST /api/recently-viewed/import`, and `DELETE /api/recently-viewed/:advertisementId` or `/api/recently-viewed`
- `GET /api/ads/:advertisementId/price-history`

Advertisement detail visits are recorded for signed-in users. Signed-out browsing history is kept in that browser's local storage; after signing in, the user can explicitly choose to import those product IDs into their account. Only currently approved advertisements are imported. Favorite, history, and preference routes derive ownership from the authenticated JWT and use parameterized database queries.

## Verification

```sh
cd backend
npm test
```

`npm test` runs the backend test suite. Run `npm run build` in `frontend` to verify the production bundle. To verify saved products end to end, sign in with two accounts, save an approved advertisement, inspect `/saved`, adjust its price or mark it sold from the seller dashboard, and verify that the buyer receives the relevant notification and sees the updated availability. Test history while signed out, sign in, and use the explicit import action to sync it. These flows require the configured PostgreSQL database; configure SMTP to verify actual email delivery.
### Guest shopping and seller ratings

The guest navbar shows the logo, search and Sign in. Guests can save products from cards or product details and open `/saved` (also linked in the footer) without authentication. Browser saves stay separate from the signed-in account wishlist and persist on that browser; account price-drop notifications require sign-in. No automatic import of guest saves occurs at sign-in.

Public seller and product pages show seller rating averages and counts. Signed-in users can submit or update one 1–5 rating per seller, and cannot rate themselves. These are community ratings, not verified-purchase reviews. The existing schema initializer creates `seller_ratings` under the startup database lock; no existing tables or ratings are deleted.

Browsing without a search term uses a randomized product order with a stable seed for pagination during that visit. Explicit price/date sorts and newest-first search results remain available. Promotion payments continue to use Bachs; pending verification references stay in the URL so users can retry status checks. This does not introduce product-purchase checkout.
