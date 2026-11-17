import { AppError } from "@/errors/AppError";
import { env } from "@/config/env";

const BASE = "https://api.rentcast.io/v1";
const TTL_MS = 10 * 60 * 1000;

// ponytail: caché en memoria por proceso (se pierde al reiniciar / no se comparte entre instancias); Redis si hay varias réplicas.
const cache = new Map<string, { at: number; data: PropertyLookup }>();

export type PropertyLookup = {
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  county?: string;
  propertyType?: "SINGLE_FAMILY" | "MULTI_FAMILY" | "CONDO" | "TOWNHOUSE" | "LAND" | "COMMERCIAL" | "OTHER";
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lotSize?: number;
  yearBuilt?: number;
  lastSalePrice?: number;
  lastSaleDate?: string;
  afterRepairValue?: number;
  ownerOccupied?: boolean;
};

const TYPE_MAP: Record<string, NonNullable<PropertyLookup["propertyType"]>> = {
  "single family": "SINGLE_FAMILY",
  condo: "CONDO",
  townhouse: "TOWNHOUSE",
  "multi-family": "MULTI_FAMILY",
  apartment: "MULTI_FAMILY",
  land: "LAND",
  commercial: "COMMERCIAL",
};

async function rc(path: string, address: string) {
  const res = await fetch(`${BASE}${path}?address=${encodeURIComponent(address)}`, {
    headers: { Accept: "application/json", "X-Api-Key": env.rentcastApiKey },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new AppError(`RentCast error ${res.status}`, 502, "RENTCAST_ERROR");
  return res.json();
}

// Dirección completa ("calle, ciudad, ST zip") -> datos de la propiedad ya con los nombres de Property.
export async function lookupProperty(address: string): Promise<PropertyLookup> {
  if (!env.rentcastApiKey) throw new AppError("RentCast no está configurado", 503, "RENTCAST_NOT_CONFIGURED");

  const key = address.toLowerCase().replace(/\s+/g, " ").trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  // AVM falla seguido en propiedades sin comps: no debe tumbar el autollenado.
  const [props, avm] = await Promise.all([rc("/properties", address), rc("/avm/value", address).catch(() => null)]);
  const r = Array.isArray(props) ? props[0] : props;
  if (!r) throw new AppError("No encontramos esa propiedad en RentCast", 404, "PROPERTY_NOT_FOUND");

  const data: PropertyLookup = {
    addressLine1: r.addressLine1,
    city: r.city,
    state: r.state,
    postalCode: r.zipCode,
    county: r.county,
    propertyType: TYPE_MAP[String(r.propertyType ?? "").toLowerCase()] ?? "OTHER",
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    squareFootage: r.squareFootage,
    lotSize: r.lotSize,
    yearBuilt: r.yearBuilt,
    lastSalePrice: r.lastSalePrice,
    lastSaleDate: r.lastSaleDate,
    afterRepairValue: avm?.price,
    ownerOccupied: r.ownerOccupied,
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}
