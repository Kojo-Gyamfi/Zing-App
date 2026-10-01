import { CLIENT_DSN, SENTRY_OPTIONS } from '@/lib/monitoring';

// Loaded only when a DSN is set, so the SDK stays out of the bundle's
// critical path for everyone else.
if (CLIENT_DSN) {
  void import('@sentry/nextjs')
    .then((Sentry) =>
      Sentry.init({
        dsn: CLIENT_DSN,
        ...SENTRY_OPTIONS,
        // The default integrations include breadcrumbs from clicks, console and
        // network; beforeBreadcrumb drops them all, but don't collect at all.
        integrations: (defaults) =>
          defaults.filter((integration) => integration.name !== 'Breadcrumbs'),
      }),
    )
    .catch(() => undefined);
}
