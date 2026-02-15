import { calculate } from './calculate.js'

self.onmessage = (e) => {
  const { points, elevation, date, options } = e.data
  
  const results = points.map(p => {
    const res = calculate(p.lat, p.lng, elevation, date, options)
    return {
      id: p.id,
      qcode: res.qcode,
      color: getCellColor(res.qcode)
    }
  })
  
  self.postMessage(results)
}

function getCellColor(qcode) {
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
  return "rgba(0,0,0,0)"
}
