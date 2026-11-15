import { getAnalytics, isSupported, logEvent } from 'firebase/analytics';
import firebaseConfig from '../../firebase-applet-config.json';
import { app } from '../firebase';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __MYFAV_GA4_ID__?: string;
  }
}

const VALID_GA4_ID_REGEX = /^G-[A-Z0-9]{6,}$/i;
const DEFAULT_GA4_MEASUREMENT_ID = 'G-EM5F71Y8GW';

let initializedMeasurementId: string | null = null;
let firebaseAnalyticsInstance: ReturnType<typeof getAnalytics> | null = null;

export function getConfiguredMeasurementId(): string {
  const envId =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_GA_MEASUREMENT_ID
      ? String(import.meta.env.VITE_GA_MEASUREMENT_ID).trim()
      : '';
  const fbId =
    typeof firebaseConfig.measurementId === 'string'
      ? firebaseConfig.measurementId.trim()
      : '';

  const candidate = envId || fbId || DEFAULT_GA4_MEASUREMENT_ID;
  return VALID_GA4_ID_REGEX.test(candidate) ? candidate : '';
}

export async function initGoogleAnalytics(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const measurementId = getConfiguredMeasurementId();
  if (!measurementId || initializedMeasurementId === measurementId) return;
  initializedMeasurementId = measurementId;

  // Initialize gtag.js for GA4 Measurement ID if not already bootstrapped in index.html
  if (window.__MYFAV_GA4_ID__ !== measurementId) {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') {
      window.gtag = function gtag(...args: unknown[]) {
        window.dataLayer?.push(args);
      };
      window.gtag('js', new Date());
    }
    window.gtag('config', measurementId, {
      send_page_view: false,
    });
    window.__MYFAV_GA4_ID__ = measurementId;

    const scriptId = 'myfav-ga4-gtag';
    const existingScript = document.querySelector(
      `script[src*="googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}"]`
    );
    if (!document.getElementById(scriptId) && !existingScript) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      document.head.appendChild(script);
    }
  }

  // Also connect Firebase Analytics SDK if firebase-applet-config.json includes measurementId
  if (
    typeof firebaseConfig.measurementId === 'string' &&
    VALID_GA4_ID_REGEX.test(firebaseConfig.measurementId.trim())
  ) {
    try {
      const supported = await isSupported();
      if (supported) {
        firebaseAnalyticsInstance = getAnalytics(app);
      }
    } catch {
      // Gracefully ignore in unsupported environments or blocked contexts
    }
  }
}

export function trackPageView(pagePath: string, pageTitle: string): void {
  const measurementId = getConfiguredMeasurementId();
  if (!measurementId || typeof window === 'undefined') return;

  try {
    if (window.gtag) {
      window.gtag('event', 'page_view', {
        page_path: pagePath,
        page_title: pageTitle,
        send_to: measurementId,
      });
    }
    if (firebaseAnalyticsInstance) {
      logEvent(firebaseAnalyticsInstance, 'page_view', {
        page_path: pagePath,
        page_title: pageTitle,
      });
    }
  } catch {
    // Never let analytics disrupt app navigation
  }
}

export function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
): void {
  const measurementId = getConfiguredMeasurementId();
  if (!measurementId || typeof window === 'undefined') return;

  try {
    if (window.gtag) {
      window.gtag('event', eventName, {
        ...params,
        send_to: measurementId,
      });
    }
    if (firebaseAnalyticsInstance) {
      logEvent(firebaseAnalyticsInstance, eventName, params);
    }
  } catch {
    // Never let analytics disrupt user actions
  }
}
