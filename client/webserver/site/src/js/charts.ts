import Doc, { Animation, clamp } from './doc'
import State from './state'
import { UnitInfo, Market, Candle, CandlesPayload } from './registry'

const bind = Doc.bind
const PIPI = 2 * Math.PI

interface Point {
  x: number
  y: number
}

interface MinMax {
  min: number
  max: number
}

interface Label {
  val: number
  txt: string
}

interface LabelSet {
  widest: number
  lbls: Label[]
}

export interface Translator {
    x: (x: number) => number
    y: (y: number) => number
    unx: (x: number) => number
    uny: (y: number) => number
    w: (w: number) => number
    h: (h: number) => number
}

export interface MouseReport {
  rate: number
  depth: number
  dotColor: string
  hoverMarkers: number[]
}

export interface VolumeReport {
  buyBase: number
  buyQuote: number
  sellBase: number
  sellQuote: number
}

export interface CandleReporters {
  mouse: (r: Candle | null) => void
}

export interface ChartReporters {
  resize: () => void,
  click: (e: MouseEvent) => void,
  zoom: (bigger: boolean) => void
}

interface Theme {
  body: string
  axisLabel: string
  gridBorder: string
  gridLines: string
  gapLine: string
  value: string
  zoom: string
  zoomHover: string
  sellLine: string
  buyLine: string
  sellFill: string
  buyFill: string
  crosshairs: string
  legendFill: string
  legendText: string
}

const darkTheme: Theme = {
  body: '#0b2031',
  axisLabel: '#b1b1b1',
  gridBorder: '#383f4b',
  gridLines: '#383f4b',
  gapLine: '#6b6b6b',
  value: '#9a9a9a',
  zoom: '#5b5b5b',
  zoomHover: '#aaa',
  sellLine: '#c60000',
  buyLine: '#00a35e',
  sellFill: '#c60000',
  buyFill: '#00a35e',
  crosshairs: '#888',
  legendFill: 'black',
  legendText: '#d5d5d5'
}

const lightTheme: Theme = {
  body: '#f4f4f4',
  axisLabel: '#1b1b1b',
  gridBorder: '#ddd',
  gridLines: '#e8e8e8',
  gapLine: '#595959',
  value: '#4d4d4d',
  zoom: '#777',
  zoomHover: '#333',
  sellLine: '#c60000',
  buyLine: '#00a35e',
  sellFill: '#c60000',
  buyFill: '#00a35e',
  crosshairs: '#595959',
  legendFill: '#e6e6e6',
  legendText: '#1b1b1b'
}

// Chart is the base class for charts.
export class Chart {
  paused: boolean
  parent: HTMLElement
  mktId: string
  report: ChartReporters
  theme: Theme
  canvas: HTMLCanvasElement
  visible: boolean
  renderScheduled: boolean
  ctx: CanvasRenderingContext2D
  mousePos: Point | null
  rect: DOMRect
  plotRegion: Region
  xLabelsRegion: Region
  yLabelsRegion: Region
  unattachers: (() => void)[]

  constructor (parent: HTMLElement, reporters: ChartReporters) {
    this.pause() // chart must be explicitly un-paused to be considered functional
    this.parent = parent
    this.report = reporters
    this.theme = State.isDark() ? darkTheme : lightTheme
    this.canvas = document.createElement('canvas')
    this.visible = true
    parent.appendChild(this.canvas)
    const ctx = this.canvas.getContext('2d')
    if (!ctx) {
      console.error('error getting canvas context')
      return
    }
    this.ctx = ctx
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'middle'
    // Mouse handling
    this.mousePos = null
    bind(this.canvas, 'mousemove', (e: MouseEvent) => {
      // this.rect will be set in resize().
      if (!this.rect) return
      this.mousePos = {
        x: e.clientX - this.rect.left,
        y: e.clientY - this.rect.y
      }
      this.draw()
    })
    bind(this.canvas, 'mouseleave', () => {
      this.mousePos = null
      this.draw()
    })

    // Bind resize.
    const resizeObserver = new ResizeObserver(() => this.resize())
    resizeObserver.observe(this.parent)

    bind(this.canvas, 'wheel', (e: WheelEvent) => { this.wheel(e) }, { passive: true })
    bind(this.canvas, 'click', (e: MouseEvent) => { this.click(e) })
    const setVis = () => {
      this.visible = document.visibilityState !== 'hidden'
      if (this.visible && this.renderScheduled) {
        this.renderScheduled = false
        this.draw()
      }
    }
    bind(document, 'visibilitychange', setVis)
    this.unattachers = [() => { Doc.unbind(document, 'visibilitychange', setVis) }]
  }

  // pause prevents certain candle chart functionality from running until it's ready to run it.
  pause () {
    this.paused = true
  }

  // unpause is the opposite of pause.
  unpause () {
    this.paused = false
  }

  /* clear the canvas. */
  clear () {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  /* draw calls the child class's render method. */
  draw () {
    this.render()
  }

  /* click is the handler for a click event on the canvas. */
  click (e: MouseEvent) {
    this.report.click(e)
  }

  /* wheel is a mousewheel event handler. */
  wheel (e: WheelEvent) {
    this.zoom(e.deltaY < 0)
  }

  /*
   * resize updates the chart size. The parentHeight is an argument to support
   * updating the height programmatically after the caller sets a style.height
   * but before the clientHeight has been updated.
   */
  resize () {
    this.canvas.width = this.parent.clientWidth
    this.canvas.height = this.parent.clientHeight
    const xLblHeight = 30 // default height of timestamp row, doesn't change
    let yLblWidth = 80 // default size of price column, depends on asset price
    // yLblWidthByAsset defines a custom price column sizes, it would be hard to calculate these dynamically,
    // and maybe it would be too jittery to do so
    const yLblWidthByAsset: {
      [key: string]: number
    } = {
      'dcr_usdc.polygon': 48,
      'dcr_usdt.polygon': 48,
      'ltc_usdt.polygon': 54,
      'dcr_btc': 78,
      'usdc.polygon_usdt.polygon': 56,
      'btc_usdt.polygon': 70,
      'dcr_polygon': 48
    }
    const yLblWidthCustom = yLblWidthByAsset[this.mktId]
    if (yLblWidthCustom) {
      yLblWidth = yLblWidthCustom
    }
    const plotExtents = new Extents(0, this.canvas.width - yLblWidth, 0, this.canvas.height - xLblHeight)
    const xLblExtents = new Extents(0, this.canvas.width - yLblWidth, this.canvas.height - xLblHeight, this.canvas.height)
    const yLblExtents = new Extents(this.canvas.width - yLblWidth, this.canvas.width, 0, this.canvas.height - xLblHeight)
    this.plotRegion = new Region(this.ctx, plotExtents)
    this.xLabelsRegion = new Region(this.ctx, xLblExtents)
    this.yLabelsRegion = new Region(this.ctx, yLblExtents)

    this.rect = this.canvas.getBoundingClientRect()
    this.report.resize()
  }

  /* zoom is called when the user scrolls the mouse wheel on the canvas. */
  zoom (bigger: boolean) {
    this.report.zoom(bigger)
  }

  /* The market handler will call unattach when the markets page is unloaded. */
  unattach () {
    for (const u of this.unattachers) u()
    this.unattachers = []
  }

  /* render must be implemented by the child class. */
  render () {
    console.error('child class must override render method')
  }

  /* applyLabelStyle applies the style used for axis tick labels. */
  applyLabelStyle (fontSize?: number) {
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'middle'
    this.ctx.font = `${fontSize ?? '14'}px 'sans', sans-serif`
    this.ctx.fillStyle = this.theme.axisLabel
  }

  /* plotXLabels applies the provided labels to the x axis and draws the grid. */
  plotXLabels (labels: LabelSet, minX: number, maxX: number, unitLines: string[]) {
    const extents = new Extents(minX, maxX, 0, 1)
    this.xLabelsRegion.plot(extents, (ctx: CanvasRenderingContext2D, tools: Translator) => {
      this.applyLabelStyle()
      const centerX = (maxX + minX) / 2
      let lastX = minX
      let unitCenter = centerX
      const [leftEdge, rightEdge] = [tools.x(minX), tools.x(maxX)]
      const centerY = tools.y(0.5)
      labels.lbls.forEach(lbl => {
        const m = ctx.measureText(lbl.txt)
        const x = tools.x(lbl.val)
        if (x - m.width / 2 < leftEdge || x + m.width / 2 > rightEdge) return
        ctx.fillText(lbl.txt, x, centerY)
        if (centerX >= lastX && centerX < lbl.val) {
          unitCenter = (lastX + lbl.val) / 2
        }
        lastX = lbl.val
      })
      ctx.font = '11px \'sans\', sans-serif'
      if (unitLines.length === 2) {
        ctx.fillText(unitLines[0], tools.x(unitCenter), tools.y(0.63))
        ctx.fillText(unitLines[1], tools.x(unitCenter), tools.y(0.23))
      } else if (unitLines.length === 1) {
        ctx.fillText(unitLines[0], tools.x(unitCenter), centerY)
      }
    }, true)
  }

  plotXGrid (labels: LabelSet, minX: number, maxX: number) {
    const extents = new Extents(minX, maxX, 0, 1)
    this.plotRegion.plot(extents, (ctx: CanvasRenderingContext2D, tools: Translator) => {
      ctx.lineWidth = 1
      ctx.strokeStyle = this.theme.gridLines
      labels.lbls.forEach(lbl => {
        line(ctx, tools.x(lbl.val), tools.y(0), tools.x(lbl.val), tools.y(1))
      })
    }, true)
  }

  /*
   * plotYLabels applies the y labels based on the provided plot region, and
   * draws the grid.
   */
  plotYLabels (labels: LabelSet, xStart: number, minX: number, maxX: number, minY: number, maxY: number) {
    const xExtents = new Extents(minX, maxX, 0, 1)
    const yExtents = new Extents(0, 1, minY, maxY)

    const xTools = this.xLabelsRegion.translator(xExtents)

    this.yLabelsRegion.plot(yExtents, (ctx: CanvasRenderingContext2D, yTools: Translator) => {
      this.applyLabelStyle()
      this.ctx.textAlign = 'left'
      const xPad = 5
      const yPadTop = 10
      const xTextStart = xTools.x(xStart) + xPad
      labels.lbls.forEach(lbl => {
        const y = yTools.y(lbl.val)
        if (y < yTools.y(maxY) + yPadTop) {
          return
        }
        ctx.fillText(lbl.txt, xTextStart, y)
      })
    }, true)
  }

  plotYGrid (region: Region, labels: LabelSet, minY: number, maxY: number) {
    const extents = new Extents(0, 1, minY, maxY)
    region.plot(extents, (ctx: CanvasRenderingContext2D, tools: Translator) => {
      ctx.lineWidth = 1
      ctx.strokeStyle = this.theme.gridLines
      labels.lbls.forEach(lbl => {
        line(ctx, tools.x(0), tools.y(lbl.val), tools.x(1), tools.y(lbl.val))
      })
    }, true)
  }

  /*
   * doYLabels generates and applies the y-axis labels, based upon the
   * provided plot region.
   */
  makeYLabels (candleRegion: Region, chartExtents: Extents, step: number, valFmt: (v: number) => string): LabelSet {
    this.applyLabelStyle()
    this.yLabelsRegion.extents.y.max = candleRegion.extents.y.max // aligns label value with Y grid line
    return makeYLabels(this.ctx, candleRegion.height(), chartExtents.y.min, chartExtents.y.max, 50, step, valFmt)
  }

  line (x0: number, y0: number, x1: number, y1: number, skipStroke?: boolean) {
    line(this.ctx, x0, y0, x1, y1, skipStroke)
  }

  /* dot draws a circle with the provided context. */
  dot (x: number, y: number, color: string, radius: number) {
    dot(this.ctx, x, y, color, radius)
  }
}

/* CandleChart is a candlestick data renderer. */
export class CandleChart extends Chart {
  reporters: CandleReporters
  data: CandlesPayload
  candleRegion: Region
  volumeRegion: Region
  resizeTimer: number
  // zoomLevels contains a bunch of levels (from zoomed in all the way to zoomed out all the way),
  // each level is how many candles to show on candle chart with "level 1" being 1 candle at the
  // very least (although it's not preferable to show less than 20 candles on the chart), and
  // "level last" being all the candle this market has
  zoomLevels: number[]
  // numToShow is how many candles we want to show, note this value must exactly match
  // one of zoomLevels (zooming code relies on it)
  numToShow: number
  market: Market
  baseUnitInfo: UnitInfo
  quoteUnitInfo: UnitInfo

  constructor (parent: HTMLElement, reporters: CandleReporters) {
    super(parent, {
      resize: () => this.resized(),
      click: (/* e: MouseEvent */) => { this.clicked() },
      zoom: (bigger: boolean) => this.zoomed(bigger)
    })
    this.reporters = reporters
    this.resize()
  }

  setMarketId (mktId: string) {
    this.mktId = mktId
  }

  /* setCandles sets the candle data and redraws the chart. */
  setCandlesAndDraw (data: CandlesPayload, market: Market, baseUnitInfo: UnitInfo, quoteUnitInfo: UnitInfo) {
    this.data = data
    this.market = market
    this.baseUnitInfo = baseUnitInfo
    this.quoteUnitInfo = quoteUnitInfo
    this.zoomLevels = []
    let lvl = Math.min(20, data.candles.length)
    while (true) {
      this.zoomLevels.push(lvl)
      lvl += 2 // add 2 candles per level
      if (lvl > data.candles.length) {
        break
      }
    }
    // ensure last level represents all the candles this market has
    if (this.zoomLevels[this.zoomLevels.length - 1] !== data.candles.length) {
      this.zoomLevels.push(data.candles.length)
    }

    // defaultLvl represents about 3 month of history for 24h duration
    const defaultLvl = Math.min(35, this.zoomLevels.length)
    this.numToShow = this.zoomLevels[defaultLvl - 1]

    this.unpause()
    this.draw()
  }

  /* resized is called when the window or parent element are resized. */
  resized () {
    const ext = this.plotRegion.extents
    const candleExtents = new Extents(ext.x.min, ext.x.max, ext.y.min, ext.y.min + ext.yRange * 0.85)
    this.candleRegion = new Region(this.ctx, candleExtents)
    const volumeExtents = new Extents(ext.x.min, ext.x.max, ext.y.min + 0.85 * ext.yRange, ext.y.max)
    this.volumeRegion = new Region(this.ctx, volumeExtents)
    // Set a delay on the render to prevent lag.
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    this.resizeTimer = window.setTimeout(() => this.draw(), 100)
  }

  clicked (/* e: MouseEvent */) {
    // handle clicks
  }

  /* zoomed zooms the current view in or out. bigger=true is zoom in. */
  zoomed (bigger: boolean) {
    if (this.paused) return
    // bigger actually means fewer candles -> reduce zoomLevels index.
    const idx = this.zoomLevels.indexOf(this.numToShow)
    if (bigger) {
      if (idx === 0) {
        return
      }
      this.numToShow = this.zoomLevels[idx - 1]
    } else {
      if (idx + 1 === this.zoomLevels.length) {
        return
      }
      this.numToShow = this.zoomLevels[idx + 1]
    }
    this.draw()
  }

  /* render draws the chart */
  render () {
    if (this.paused) {
      this.renderScheduled = true
      return
    }
    const data = this.data
    if (!data || !this.visible || this.canvas.width === 0) {
      this.renderScheduled = true
      return
    }
    const candleWidth = data.ms
    const mousePos = this.mousePos
    const allCandles = data.candles || []
    const rateStep = this.market.ratestep

    this.clear()

    // If there are no candles. just don't draw anything.
    if (this.numToShow === 0) return

    const candles = allCandles.slice(allCandles.length - this.numToShow)

    // padding definition and some helper functions to parse candles.
    const candleWidthPadding = 0.2
    const start = (c: Candle) => truncate(c.endStamp, candleWidth)
    const end = (c: Candle) => start(c) + candleWidth
    const paddedStart = (c: Candle) => start(c) + candleWidthPadding * candleWidth
    const paddedWidth = (1 - 2 * candleWidthPadding) * candleWidth

    const candleFirst = candles[0]
    const candleLast = candles[this.numToShow - 1]

    const startStamp = start(candleFirst)
    const endStamp = end(candleLast)
    let [highPrice, lowPrice, highVol] = [candleFirst.highRate, candleFirst.lowRate, candleFirst.matchVolume]
    for (const c of candles) {
      if (c.highRate > highPrice) highPrice = c.highRate
      if (c.lowRate < lowPrice) lowPrice = c.lowRate
      if (c.matchVolume > highVol) highVol = c.matchVolume
    }
    const xPadding = (endStamp - startStamp) * 0.05 // padding for candles on the right
    const yPadding = (highPrice - lowPrice) * 0.16 // padding for candles on the top
    // Calculate data extents and store them. They are used to apply labels.
    const chartExtents = new Extents(
      startStamp,
      endStamp + xPadding,
      lowPrice,
      highPrice + yPadding
    )
    if (lowPrice === highPrice) {
      // If there is no price movement at all in the window, show a little more
      // top and bottom so things render nicely.
      chartExtents.y.min -= rateStep
      chartExtents.y.max += rateStep
    }

    let mouseCandle: Candle | null = null
    if (mousePos) {
      this.plotRegion.plot(new Extents(chartExtents.x.min, chartExtents.x.max, 0, 1), (ctx, tools) => {
        const selectedStartStamp = truncate(tools.unx(mousePos.x), candleWidth)
        for (const c of candles) {
          if (start(c) === selectedStartStamp) {
            mouseCandle = c
            ctx.fillStyle = this.theme.gridLines
            ctx.fillRect(tools.x(start(c)), tools.y(0), tools.w(candleWidth), tools.h(1))
            break
          }
        }
      })
    }

    // Draw the grid
    const xLabels = makeCandleTimeLabels(candles, candleWidth, this.plotRegion.width(), 100)
    this.plotXGrid(xLabels, chartExtents.x.min, chartExtents.x.max)
    const yLabels = this.makeYLabels(
      this.candleRegion,
      chartExtents,
      rateStep,
      v => Doc.formatRateAtomToRateStep(v, this.baseUnitInfo, this.quoteUnitInfo, this.market.ratestep)
    )
    this.plotYGrid(this.candleRegion, yLabels, chartExtents.y.min, chartExtents.y.max)

    // Draw the volume bars.
    const volDataExtents = new Extents(chartExtents.x.min, chartExtents.x.max, 0, highVol)
    this.volumeRegion.plot(volDataExtents, (ctx, tools) => {
      ctx.fillStyle = this.theme.gridBorder
      for (const c of candles) {
        ctx.fillRect(tools.x(paddedStart(c)), tools.y(0), tools.w(paddedWidth), tools.h(c.matchVolume))
      }
    })

    // Draw the candles.
    this.candleRegion.plot(chartExtents, (ctx, tools) => {
      ctx.lineWidth = 1
      for (const c of candles) {
        const desc = c.startRate > c.endRate
        const [x, y, w, h] = [tools.x(paddedStart(c)), tools.y(c.startRate), tools.w(paddedWidth), tools.h(c.endRate - c.startRate)]
        const [high, low, cx] = [tools.y(c.highRate), tools.y(c.lowRate), w / 2 + x]
        ctx.strokeStyle = desc ? this.theme.sellLine : this.theme.buyLine
        ctx.fillStyle = desc ? this.theme.sellFill : this.theme.buyFill

        ctx.beginPath()
        ctx.moveTo(cx, high)
        ctx.lineTo(cx, low)
        ctx.stroke()

        ctx.fillRect(x, y, w, h)
        ctx.strokeRect(x, y, w, h)
      }
    })

    // Apply labels.
    this.plotXLabels(xLabels, chartExtents.x.min, chartExtents.x.max, [])
    this.plotYLabels(
      yLabels,
      endStamp + xPadding,
      chartExtents.x.min,
      chartExtents.x.max,
      chartExtents.y.min,
      chartExtents.y.max
    )

    // Highlight the candle if the user mouse is over the canvas.
    if (mouseCandle) {
      const yExt = this.xLabelsRegion.extents.y
      this.xLabelsRegion.plot(new Extents(chartExtents.x.min, chartExtents.x.max, yExt.min, yExt.max), (ctx, tools) => {
        if (!mouseCandle) return // For TypeScript. Duh.
        this.applyLabelStyle()
        const rangeTxt = Doc.ymdhmSinceFromMS(start(mouseCandle))
        const [xPad, yPad] = [2, 2]
        const rangeWidth = ctx.measureText(rangeTxt).width + 2 * xPad
        const rangeHeight = 16
        let centerX = tools.x((start(mouseCandle) + end(mouseCandle)) / 2)
        let left = centerX - rangeWidth / 2
        const xExt = this.xLabelsRegion.extents.x
        if (left < xExt.min) left = xExt.min
        else if (left + rangeWidth > xExt.max) left = xExt.max - rangeWidth
        centerX = left + rangeWidth / 2
        const top = yExt.min + (this.xLabelsRegion.height() - rangeHeight) / 2
        ctx.fillStyle = this.theme.legendFill
        ctx.strokeStyle = this.theme.gridBorder
        const rectArgs: [number, number, number, number] = [left - xPad, top - yPad, rangeWidth + 2 * xPad, rangeHeight + 2 * yPad]
        ctx.fillRect(...rectArgs)
        ctx.strokeRect(...rectArgs)
        this.applyLabelStyle()
        ctx.fillText(rangeTxt, centerX, this.xLabelsRegion.extents.midY, rangeWidth)
      })
    }

    // Report the mouse candle.
    this.reporters.mouse(mouseCandle)
  }
}

interface WaveOpts {
  message?: string
  backgroundColor?: string | boolean // true for <body> background color
}

/* Wave is a loading animation that displays a colorful line that oscillates */
export class Wave extends Chart {
  ani: Animation
  size: [number, number]
  region: Region
  colorShift: number
  opts: WaveOpts
  msgRegion: Region
  fontSize: number

  constructor (parent: HTMLElement, opts?: WaveOpts) {
    super(parent, {
      resize: () => this.resized(),
      click: (/* e: MouseEvent */) => { /* pass */ },
      zoom: (/* bigger: boolean */) => { /* pass */ }
    })
    // pausing is only relevant for candle-chart, but we share the same code - hence gotta take care of this
    this.unpause()
    this.canvas.classList.add('fill-abs')
    this.canvas.style.zIndex = '5'

    this.opts = opts ?? {}

    const period = 1500 // ms
    const start = Math.random() * period
    this.colorShift = Math.random() * 360

    // y = A*cos(k*x + theta*t + c)
    // combine three waves with different periods and speeds and phases.
    const amplitudes = [1, 0.65, 0.75]
    const ks = [3, 3, 2]
    const speeds = [Math.PI, Math.PI * 10 / 9, Math.PI / 2.5]
    const phases = [0, 0, Math.PI * 1.5]
    const n = 75
    const single = (n: number, angularX: number, angularTime: number): number => {
      return amplitudes[n] * Math.cos(ks[n] * angularX + speeds[n] * angularTime + phases[n])
    }
    const value = (x: number, angularTime: number): number => {
      const angularX = x * Math.PI * 2
      return (single(0, angularX, angularTime) + single(1, angularX, angularTime) + single(2, angularX, angularTime)) / 3
    }
    this.resize()
    this.ani = new Animation(Animation.Forever, () => {
      const angularTime = (new Date().getTime() - start) / period * Math.PI * 2
      const values = []
      for (let i = 0; i < n; i++) {
        values.push(value(i / (n - 1), angularTime))
      }
      this.drawValues(values)
    })
  }

  resized () {
    const opts = this.opts
    const [maxW, maxH] = [150, 100]
    const [cw, ch] = [this.canvas.width, this.canvas.height]
    let [w, h] = [cw * 0.8, ch * 0.8]
    if (w > maxW) w = maxW
    if (h > maxH) h = maxH
    let [l, t] = [(cw - w) / 2, (ch - h) / 2]
    if (opts.message) {
      this.fontSize = clamp(h * 0.15, 10, 14)
      this.applyLabelStyle(this.fontSize)
      const ypad = this.fontSize * 0.5
      const halfH = (this.fontSize / 2) + ypad
      t -= halfH
      this.msgRegion = new Region(this.ctx, new Extents(0, cw, t + h, t + h + 2 * halfH))
    }
    this.region = new Region(this.ctx, new Extents(l, l + w, t, t + h))
  }

  drawValues (values: number[]) {
    if (!this.region) return
    this.clear()
    const hsl = (h: number) => `hsl(${h}, 35%, 50%)`

    const { region, msgRegion, canvas: { width: w, height: h }, opts: { backgroundColor: bg, message: msg }, colorShift, ctx } = this

    if (bg) {
      if (bg === true) ctx.fillStyle = State.isDark() ? '#0a1e34' : '#f0f0f0'
      else ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)
    }

    region.plot(new Extents(0, 1, -1, 1), (ctx: CanvasRenderingContext2D, t: Translator) => {
      ctx.lineWidth = 4
      ctx.lineCap = 'round'

      const shift = colorShift + (new Date().getTime() % 2000) / 2000 * 360 // colors move with frequency 1 / 2s
      const grad = ctx.createLinearGradient(t.x(0), 0, t.x(1), 0)
      grad.addColorStop(0, hsl(shift))
      ctx.strokeStyle = grad

      ctx.beginPath()
      ctx.moveTo(t.x(0), t.y(values[0]))
      for (let i = 1; i < values.length; i++) {
        const prog = i / (values.length - 1)
        grad.addColorStop(prog, hsl(prog * 300 + shift))
        ctx.lineTo(t.x(prog), t.y(values[i]))
      }
      ctx.stroke()
    })
    if (!msg) return
    msgRegion.plot(new Extents(0, 1, 0, 1), (ctx: CanvasRenderingContext2D, t: Translator) => {
      this.applyLabelStyle(this.fontSize)
      ctx.fillText(msg, t.x(0.5), t.y(0.5), this.msgRegion.width())
    })
  }

  render () { /* pass */ }

  stop () {
    this.ani.stop()
    this.canvas.remove()
  }
}

/*
 * Extents holds a min and max in both the x and y directions, and provides
 * getters for related data.
 */
export class Extents {
  x: MinMax
  y: MinMax

  constructor (xMin: number, xMax: number, yMin: number, yMax: number) {
    this.setExtents(xMin, xMax, yMin, yMax)
  }

  setExtents (xMin: number, xMax: number, yMin: number, yMax: number) {
    this.x = {
      min: xMin,
      max: xMax
    }
    this.y = {
      min: yMin,
      max: yMax
    }
  }

  get xRange (): number {
    return this.x.max - this.x.min
  }

  get midX (): number {
    return (this.x.max + this.x.min) / 2
  }

  get yRange (): number {
    return this.y.max - this.y.min
  }

  get midY (): number {
    return (this.y.max + this.y.min) / 2
  }
}

/*
 * Region applies an Extents to the canvas, providing utilities for coordinate
 * transformations and restricting drawing to a specified region of the canvas.
 */
export class Region {
  context: CanvasRenderingContext2D
  extents: Extents

  constructor (context: CanvasRenderingContext2D, extents: Extents) {
    this.context = context
    this.extents = extents
  }

  setExtents (xMin: number, xMax: number, yMin: number, yMax: number) {
    this.extents.setExtents(xMin, xMax, yMin, yMax)
  }

  width (): number {
    return this.extents.xRange
  }

  height (): number {
    return this.extents.yRange
  }

  contains (x: number, y: number): boolean {
    const ext = this.extents
    return (x < ext.x.max && x > ext.x.min &&
      y < ext.y.max && y > ext.y.min)
  }

  /*
   * A translator provides 4 function for coordinate transformations. x and y
   * translate data coordinates to canvas coordinates for the specified data
   * Extents. unx and uny translate canvas coordinates to data coordinates.
   */
  translator (dataExtents: Extents): Translator {
    const region = this.extents
    const xMin = dataExtents.x.min
    // const xMax = dataExtents.x.max
    const yMin = dataExtents.y.min
    // const yMax = dataExtents.y.max
    const yRange = dataExtents.yRange
    const xRange = dataExtents.xRange
    const screenMinX = region.x.min
    const screenW = region.x.max - screenMinX
    const screenMaxY = region.y.max
    const screenH = screenMaxY - region.y.min
    const xFactor = screenW / xRange
    const yFactor = screenH / yRange
    return {
      x: (x: number) => (x - xMin) * xFactor + screenMinX,
      y: (y: number) => screenMaxY - (y - yMin) * yFactor,
      unx: (x: number) => (x - screenMinX) / xFactor + xMin,
      uny: (y: number) => yMin - (y - screenMaxY) / yFactor,
      w: (w: number) => w / xRange * screenW,
      h: (h: number) => -h / yRange * screenH
    }
  }

  /* clear clears the region. */
  clear () {
    const ext = this.extents
    this.context.clearRect(ext.x.min, ext.y.min, ext.xRange, ext.yRange)
  }

  /* plot prepares tools for drawing using data coordinates. */
  plot (dataExtents: Extents, drawFunc: (ctx: CanvasRenderingContext2D, tools: Translator) => void, skipMask?: boolean) {
    const ctx = this.context
    const region = this.extents
    ctx.save() // Save the original state
    if (!skipMask) {
      ctx.beginPath()
      ctx.rect(region.x.min, region.y.min, region.xRange, region.yRange)
      ctx.clip()
    }

    // The drawFunc will be passed a set of tool that can be used to assist
    // drawing. The tools start with the transformation functions.
    const tools = this.translator(dataExtents)

    // Create a transformation that allows drawing in data coordinates. It's
    // not advisable to stroke or add text with this transform in place, as the
    // result will be distorted. You can however use ctx.moveTo and ctx.lineTo
    // with this transform in place using data coordinates, and remove the
    // transform before stroking. The dataCoords method of the supplied tool
    // provides this functionality.

    // TODO: Figure out why this doesn't work on WebView.
    // const yRange = dataExtents.yRange
    // const xFactor = region.xRange / dataExtents.xRange
    // const yFactor = region.yRange / yRange
    // const xMin = dataExtents.x.min
    // const yMin = dataExtents.y.min
    // // These translation factors are complicated because the (0, 0) of the
    // // region is not necessarily the (0, 0) of the canvas.
    // const tx = (region.x.min + xMin) - xMin * xFactor
    // const ty = -region.y.min - (yRange - yMin) * yFactor
    // const setTransform = () => {
    //   // Data coordinates are flipped about y. Flip the coordinates and
    //   // translate top left corner to canvas (0, 0).
    //   ctx.transform(1, 0, 0, -1, -xMin, yMin)
    //   // Scale to data coordinates and shift into place for the region's offset
    //   // on the canvas.
    //   ctx.transform(xFactor, 0, 0, yFactor, tx, ty)
    // }
    // // dataCoords allows some drawing to be performed directly in data
    // // coordinates. Most actual drawing functions like ctx.stroke and
    // // ctx.fillRect should not be called from inside dataCoords, but
    // // ctx.moveTo and ctx.LineTo are fine.
    // tools.dataCoords = f => {
    //   ctx.save()
    //   setTransform()
    //   f()
    //   ctx.restore()
    // }

    drawFunc(this.context, tools)
    ctx.restore()
  }
}

/*
 * makeYLabels attempts to create the appropriate labels for the specified
 * screen size, context, and label spacing.
 */
function makeYLabels (
  ctx: CanvasRenderingContext2D,
  screenHeight: number,
  min: number,
  max: number,
  spacingGuess: number,
  step: number,
  valFmt: (v: number) => string
): LabelSet {
  const n = screenHeight / spacingGuess
  const diff = max - min
  if (n < 1 || diff <= 0) return { widest: 0, lbls: [] }
  const tickGuess = diff / n
  // make the tick spacing a multiple of the step
  const tick = tickGuess + step - (tickGuess % step)
  let x = min + tick - (min % tick)
  const pts: Label[] = []
  let widest = 0
  while (x < max) {
    const lbl = valFmt(x)
    widest = Math.max(widest, ctx.measureText(lbl).width)
    pts.push({
      val: x,
      txt: lbl
    })
    x += tick
  }
  return {
    widest: widest,
    lbls: pts
  }
}

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/* makeCandleTimeLabels prepares labels for candlestick data. */
function makeCandleTimeLabels (candles: Candle[], dur: number, screenW: number, spacingGuess: number): LabelSet {
  const first = candles[0]
  const last = candles[candles.length - 1]
  const start = truncate(first.endStamp, dur)
  const end = truncate(last.endStamp, dur) + dur
  const diff = end - start
  const n = Math.min(candles.length, screenW / spacingGuess)
  const tick = truncate(diff / n, dur)
  if (tick === 0) {
    console.error('zero tick', dur, diff, n) // probably won't happen, but it'd suck if it did
    return { widest: 0, lbls: [] }
  }
  let x = start
  const zoneOffset = new Date().getTimezoneOffset()
  const dayStamp = (x: number) => {
    x = x - zoneOffset * 60000
    return x - (x % 86400000)
  }
  let lastDay = dayStamp(start)
  let lastYear = 0 // new Date(start).getFullYear()
  if (dayStamp(first.endStamp) === dayStamp(last.endStamp)) lastDay = 0 // Force at least one day stamp.
  const pts = []
  let label
  if (dur < 86400000) {
    label = (d: Date, x: number) => {
      const day = dayStamp(x)
      if (day !== lastDay) return `${months[d.getMonth()]}${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
      else return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    }
  } else {
    label = (d: Date) => {
      const year = d.getFullYear()
      if (year !== lastYear) return `${months[d.getMonth()]}${d.getDate()} '${String(year).slice(2, 4)}`
      else return `${months[d.getMonth()]}${d.getDate()}`
    }
  }
  while (x <= end) {
    const d = new Date(x)
    pts.push({
      val: x,
      txt: label(d, x)
    })
    lastDay = dayStamp(x)
    lastYear = d.getFullYear()
    x += tick
  }
  return { widest: 0, lbls: pts }
}

/* line draws a line with the provided context. */
function line (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, skipStroke?: boolean) {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  if (!skipStroke) ctx.stroke()
}

/* dot draws a circle with the provided context. */
function dot (ctx: CanvasRenderingContext2D, x: number, y: number, color: string, radius: number) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, PIPI)
  ctx.fill()
}

function truncate (v: number, w: number): number {
  return v - (v % w)
}
