export { calculate, getCellColor } from './calculate.js'
export { getMoonImageURLs } from './moonNow.js'
export { geocode } from './geocoder.js'

export function getHemisphere(lat) {
  return lat >= 0 ? 'north' : 'south';
}
