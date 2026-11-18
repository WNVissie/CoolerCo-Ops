// CoolerCo Field — Android shell.
// The app opens the live Field app (CAP_SERVER_URL, e.g. https://<your-site>/field), so every Netlify deploy
// reaches the phones at once — a new APK is only needed when this native shell changes.
const url = process.env.CAP_SERVER_URL
if (!url) console.warn('⚠️  CAP_SERVER_URL is not set — the APK will not know which site to open.')

module.exports = {
  appId: 'za.co.smartpartners.coolercofield',
  appName: 'CoolerCo Field',
  webDir: 'www',
  server: url ? { url, cleartext: false, errorPath: 'error.html' } : undefined,
  android: { allowMixedContent: false },
  plugins: {
    LocalNotifications: { smallIcon: 'ic_stat_coolerco', iconColor: '#0B5CD5' },
  },
}
