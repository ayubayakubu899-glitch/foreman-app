# Google Earth/Maps API Integration Guide

## Quick Setup (5 minutes)

### Option 1: Using Free Google Maps API (Recommended for Testing)

1. **Get API Key**
   - Visit: https://console.cloud.google.com
   - Create new project or select existing
   - Enable "Maps JavaScript API"
   - Go to Credentials → Create API Key
   - Copy the key

2. **Add to Project**
   - Open `.env` file
   - Add: `GOOGLE_EARTH_API_KEY=YOUR_KEY_HERE`
   - Save and restart server

3. **Test It**
   - Sign in to dashboard
   - You should see an interactive map with satellite view
   - Try dropping a pin

### Option 2: Without API Key (Fallback Mode)

If you don't have an API key yet, the app will show:
- A styled fallback map display
- Instructions to add your API key
- All other features work normally

The map will work once you add your API key!

## API Key Security

### Restrict Your Key (Important!)
1. In Google Cloud Console, select your API key
2. Click "Edit"
3. Under "API restrictions":
   - Select "Maps JavaScript API" only
   - Uncheck other APIs
4. Under "Application restrictions":
   - Choose "HTTP referrers (web sites)"
   - Add: `localhost:3000`
   - Add: `yourwebsite.com`
5. Click "Save"

## Pricing

- **Free Tier**: $200/month credit (covers most use)
- **Pay as you go**: After free tier
- **Estimated Cost**: ~$7 per 1000 map loads

For development/testing, you won't hit any costs!

## Troubleshooting

### "Google is not defined"
- API key is invalid or API not enabled
- Check `.env` file has correct key
- Verify Maps JavaScript API is enabled in Cloud Console

### Map not showing
- Restart server after adding API key
- Clear browser cache (Ctrl+Shift+Delete)
- Check browser console for errors (F12)

### Quota Exceeded
- Upgrade to a paid account
- Or wait for monthly reset
- Check usage in Google Cloud Console

## Features Once API is Active

✅ Satellite, Hybrid, and Roadmap views
✅ Zoom and pan controls
✅ Full-screen mode
✅ Street View integration
✅ Location markers with animations
✅ Pin dropping with color coding:
  - Yellow = Foreman pins
  - Red = User pins
  - Blue = Sample locations

## Advanced Features (Optional)

### Enable Earth Engine API
1. Go to Google Cloud Console
2. Search "Earth Engine API"
3. Click "Enable"
4. No additional setup needed
5. Automatically available in map

### Street View
- Already included with Maps API
- Click Street View icon to use

## Need Help?

- Google Maps Documentation: https://developers.google.com/maps
- API Issues: https://issuetracker.google.com/issues?q=componentid:187214
- Stack Overflow: Tag with "google-maps-api"

## Production Deployment

### Before Going Live:
1. Switch from localhost to production domain
2. Update API key restrictions
3. Monitor usage in Google Cloud Console
4. Set up billing alerts
5. Use API key signing for enhanced security
