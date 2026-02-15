const MOON_YEAR_INFO = {
  2022: { id_north: 4955, id_south: 4956, nimages: 8760 },
  2023: { id_north: 5048, id_south: 5049, nimages: 8760 },
  2024: { id_north: 5187, id_south: 5188, nimages: 8760 },
  2025: { id_north: 5415, id_south: 5416, nimages: 8760 },
  2026: { id_north: 5587, id_south: 5588, nimages: 8760 },
}

function getYearId(year) {
  if (MOON_YEAR_INFO[year]) {
    return MOON_YEAR_INFO[year]
  }
  
  if (year >= 2027) {
    const baseId = 5587 + (year - 2026) * 130
    return { id_north: baseId, id_south: baseId + 1, nimages: 8760 }
  }
  
  return null
}

export function getMoonImageURLs(date = new Date(), southern = false) {
  const moon_domain = "https://svs.gsfc.nasa.gov"
  const moon_year = date.getFullYear()

  const yearInfo = getYearId(moon_year)

  if (!yearInfo) {
    throw new Error(`Moon images not available for year ${moon_year}`)
  }

  const id = southern ? yearInfo.id_south : yearInfo.id_north
  const idStr = String(id).padStart(6, "0")
  
  // NASA SVS uses a nested directory structure based on the ID.
  // The first level is the thousands (a000000)
  // The second level is the hundreds (e.g., a005400 for 5415)
  // The third level is the exact ID (e.g., a005415)
  const hundreds = Math.floor(id / 100) * 100
  const hundredsStr = String(hundreds).padStart(6, "0")
  const pathPrefix = `/vis/a000000/a${hundredsStr}/a${idStr}`

  const year = date.getUTCFullYear()
  const moon_nimages = yearInfo.nimages
  const janone = Date.UTC(year, 0, 1, 0, 0, 0)
  let moon_imagenum = 1 + Math.round((date.getTime() - janone) / 3600000.0)
  if (moon_imagenum > moon_nimages) moon_imagenum = moon_nimages
  if (moon_imagenum < 1) moon_imagenum = 1

  const filename = "moon." + String(moon_imagenum).padStart(4, "0")

  return {
    jpg: `${moon_domain}${pathPrefix}/frames/730x730_1x1_30p/${filename}.jpg`,
    tif: `${moon_domain}${pathPrefix}/frames/5760x3240_16x9_30p/plain/${filename}.tif`,
  }
}
