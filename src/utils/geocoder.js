export function geocode([lng, lat]) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`
  return fetch(url)
    .then((response) => response.json())
    .then((data) => data.display_name)
}
