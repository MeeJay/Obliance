import http from 'http';
import { db } from '../db';
import { logger } from '../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────
interface GeoResult {
  lat: number;
  lng: number;
  city: string;
  country: string;
  region: string;
}

interface CacheEntry {
  result: GeoResult | null;
  timestamp: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_MAX = 1000;
const RATE_LIMIT_MAX = 40;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// ── Private IP detection ──────────────────────────────────────────────────────
function isPrivateIP(ip: string): boolean {
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

class GeolocationService {
  private cache = new Map<string, CacheEntry>();
  private requestTimestamps: number[] = [];

  // ── Rate limiter ──────────────────────────────────────────────────────────
  private canMakeRequest(): boolean {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    return this.requestTimestamps.length < RATE_LIMIT_MAX;
  }

  private recordRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  // ── Cache management ──────────────────────────────────────────────────────
  private getCached(ip: string): GeoResult | null | undefined {
    const entry = this.cache.get(ip);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(ip);
      return undefined;
    }
    return entry.result;
  }

  private setCache(ip: string, result: GeoResult | null): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= CACHE_MAX) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(ip, { result, timestamp: Date.now() });
  }

  // ── Core geolocate ───────────────────────────────────────────────────────
  async geolocate(ip: string): Promise<GeoResult | null> {
    if (isPrivateIP(ip)) return null;

    const cached = this.getCached(ip);
    if (cached !== undefined) return cached;

    if (!this.canMakeRequest()) {
      logger.warn({ ip }, 'Geolocation rate limit reached, skipping');
      return null;
    }

    try {
      this.recordRequest();
      const data = await this.httpGet(`http://ip-api.com/json/${ip}?fields=lat,lon,city,regionName,country`);
      const json = JSON.parse(data);

      if (!json.lat && !json.lon) {
        this.setCache(ip, null);
        return null;
      }

      const result: GeoResult = {
        lat: json.lat,
        lng: json.lon,
        city: json.city || '',
        country: json.country || '',
        region: json.regionName || '',
      };
      this.setCache(ip, result);
      return result;
    } catch (err) {
      logger.warn({ ip, err }, 'Geolocation lookup failed');
      return null;
    }
  }

  // ── Update device geo columns ─────────────────────────────────────────────
  async updateDeviceGeo(deviceId: number, ip: string): Promise<void> {
    const geo = await this.geolocate(ip);
    if (!geo) return;

    await db('devices').where({ id: deviceId }).update({
      geo_lat: geo.lat,
      geo_lng: geo.lng,
      geo_city: geo.city,
      geo_country: geo.country,
      geo_region: geo.region,
    });
  }

  // ── Simple HTTP GET (no npm deps) ─────────────────────────────────────────
  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      http.get(url, { timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve(body));
        res.on('error', reject);
      }).on('error', reject);
    });
  }
}

export const geolocationService = new GeolocationService();
