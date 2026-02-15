import * as Astronomy from 'astronomy-engine'

export function calculate(latitude, longitude, altitude = 0, baseTime, options = {}) {
  const { evening = true, yallop = true } = options
  let details = {}

  baseTime = Astronomy.MakeTime(baseTime)
  const observer = new Astronomy.Observer(latitude, longitude, altitude)
  const time = baseTime.AddDays(-observer.longitude / 360)

  const direction = evening ? -1 : 1
  const sunsetSunrise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, direction, time, 1)
  const moonsetMoonrise = Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, direction, time, 1)

  if (sunsetSunrise == null || moonsetMoonrise == null) {
    details.qcode = "H"
    return details
  }

  const lagTime = (moonsetMoonrise.ut - sunsetSunrise.ut) * (evening ? 1 : -1)
  const bestTime = lagTime < 0
    ? sunsetSunrise.date
    : sunsetSunrise.AddDays(((lagTime * 4) / 9) * (evening ? 1 : -1))

  details.lagTime = lagTime
  details.moonsetMoonrise = moonsetMoonrise.date
  details.sunsetSunrise = sunsetSunrise.date

  const newMoonPrev = Astronomy.SearchMoonPhase(0, sunsetSunrise.date, -35).date
  const newMoonNext = Astronomy.SearchMoonPhase(0, sunsetSunrise.date, +35).date
  const newMoonNearest = sunsetSunrise.ut - newMoonPrev.ut <= newMoonNext.ut - sunsetSunrise.ut
    ? newMoonPrev
    : newMoonNext

  details.newMoonPrev = newMoonPrev
  details.newMoonNext = newMoonNext
  details.moonAgePrev = bestTime.ut - newMoonPrev.ut
  details.moonAgeNext = bestTime.ut - newMoonNext.ut

  const beforeNewMoon = (sunsetSunrise.ut - newMoonNearest.ut) * (evening ? 1 : -1) < 0
  if (lagTime < 0 && beforeNewMoon) details.qcode = "J"
  if (lagTime < 0) details.qcode = "I"
  if (beforeNewMoon) details.qcode = "G"

  const sunEquator = Astronomy.Equator(Astronomy.Body.Sun, bestTime, observer, true, true)
  const sunHorizon = Astronomy.Horizon(bestTime, observer, sunEquator.ra, sunEquator.dec, null)
  const moonEquator = Astronomy.Equator(Astronomy.Body.Moon, bestTime, observer, true, true)
  const moonHorizon = Astronomy.Horizon(bestTime, observer, moonEquator.ra, moonEquator.dec, null)
  const libration = Astronomy.Libration(bestTime)

  const SD = (libration.diam_deg * 60) / 2
  const lunarParallax = SD / 0.27245
  const SDTopo = SD * (1 + Math.sin(moonHorizon.altitude * Astronomy.DEG2RAD) * Math.sin((lunarParallax / 60) * Astronomy.DEG2RAD))

  const ARCL = yallop
    ? Astronomy.Elongation(Astronomy.Body.Moon, bestTime).elongation
    : Astronomy.AngleBetween(sunEquator.vec, moonEquator.vec).angle

  const DAZ = sunHorizon.azimuth - moonHorizon.azimuth

  let ARCV
  if (yallop) {
    const geoMoon = Astronomy.GeoVector(Astronomy.Body.Moon, bestTime, true)
    const geoSun = Astronomy.GeoVector(Astronomy.Body.Sun, bestTime, true)
    const rot = Astronomy.Rotation_EQJ_EQD(bestTime)
    const rotMoon = Astronomy.RotateVector(rot, geoMoon)
    const rotSun = Astronomy.RotateVector(rot, geoSun)
    const meq = Astronomy.EquatorFromVector(rotMoon)
    const seq = Astronomy.EquatorFromVector(rotSun)
    const mhor = Astronomy.Horizon(bestTime, observer, meq.ra, meq.dec, null)
    const shor = Astronomy.Horizon(bestTime, observer, seq.ra, seq.dec, null)
    ARCV = mhor.altitude - shor.altitude
  } else {
    let COSARCV = Math.cos(ARCL * Astronomy.DEG2RAD) / Math.cos(DAZ * Astronomy.DEG2RAD)
    if (COSARCV < -1) COSARCV = -1
    else if (COSARCV > +1) COSARCV = +1
    ARCV = Math.acos(COSARCV) * Astronomy.RAD2DEG
  }
  const WTopo = SDTopo * (1 - Math.cos(ARCL * Astronomy.DEG2RAD))

  let result = " "
  let value
  if (yallop) {
    value = (ARCV - (11.8371 - 6.3226 * WTopo + 0.7319 * Math.pow(WTopo, 2) - 0.1018 * Math.pow(WTopo, 3))) / 10
    if (value > +0.216) result = "A"
    else if (value > -0.014) result = "B"
    else if (value > -0.16) result = "C"
    else if (value > -0.232) result = "D"
    else if (value > -0.293) result = "E"
    else result = "F"
  } else {
    value = ARCV - (7.1651 - 6.3226 * WTopo + 0.7319 * Math.pow(WTopo, 2) - 0.1018 * Math.pow(WTopo, 3))
    if (value >= 5.65) result = "A"
    else if (value >= 2.0) result = "C"
    else if (value >= -0.96) result = "E"
    else result = "F"
  }

  details.qcode = result
  details.bestTime = bestTime
  details.sd = SD
  details.lunarParallax = lunarParallax
  details.arcl = ARCL
  details.arcv = ARCV
  details.daz = DAZ
  details.wTopo = WTopo
  details.sdTopo = SDTopo
  details.value = value
  details.moonAzimuth = moonHorizon.azimuth
  details.moonAltitude = moonHorizon.altitude
  details.moonRa = moonHorizon.ra
  details.moonDec = moonHorizon.dec
  details.sunAzimuth = sunHorizon.azimuth
  details.sunAltitude = sunHorizon.altitude
  details.sunRa = sunHorizon.ra
  details.sunDec = sunHorizon.dec

  return details
}

export function getCellColor(qcode) {
  if (qcode === "A") return "#22c55e"
  else if (qcode === "B") return "#84cc16"
  else if (qcode === "C") return "#2dd4bf"
  else if (qcode === "D") return "#facc15"
  else if (qcode === "E") return "#fb923c"
  else if (qcode === "F") return "rgba(0, 0, 0, 0)"
  else if (qcode === "G") return "#a855f7"
  else if (qcode === "H") return "#3b82f6"
  else if (qcode === "I") return "#ef4444"
  else if (qcode === "J") return "rgba(0, 0, 0, 0)"
  return null
}
