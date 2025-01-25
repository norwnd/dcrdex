import * as intl from './locales'
import {
  UnitInfo,
  LayoutMetrics,
  PageElement
} from './registry'
import State from './state'

// Symbolizer is satisfied by both dex.Asset and core.SupportedAsset. Used by
// Doc.symbolize.
interface Symbolizer {
  symbol: string
  unitInfo: UnitInfo
}

const parser = new window.DOMParser()

const FPS = 30

const BipIDs: Record<number, string> = {
  0: 'btc',
  42: 'dcr',
  2: 'ltc',
  5: 'dash',
  20: 'dgb',
  22: 'mona',
  28: 'vtc',
  3: 'doge',
  145: 'bch',
  60: 'eth',
  60001: 'usdc.eth',
  60002: 'usdt.eth',
  60003: 'matic.eth',
  136: 'firo',
  133: 'zec',
  966: 'polygon',
  966001: 'usdc.polygon',
  966002: 'weth.polygon',
  966003: 'wbtc.polygon',
  966004: 'usdt.polygon',
  147: 'zcl'
}

const BipSymbolIDs: Record<string, number> = {};
(function () {
  for (const k of Object.keys(BipIDs)) {
    BipSymbolIDs[BipIDs[parseInt(k)]] = parseInt(k)
  }
})()

const BipSymbols = Object.values(BipIDs)

const RateEncodingFactor = 1e8

const log10RateEncodingFactor = Math.round(Math.log10(RateEncodingFactor))

const languages = navigator.languages.filter((locale: string) => locale !== 'c')

const intFormatter = new Intl.NumberFormat(languages, { maximumFractionDigits: 0, useGrouping: false })

const fourSigFigs = new Intl.NumberFormat(languages, {
  maximumSignificantDigits: 4,
  useGrouping: false
})

/* A cache for formatters used for Doc.formatFullPrecision. */
const fullPrecisionFormatters: Record<number, Intl.NumberFormat> = {}

/*
 * fullPrecisionFormatter gets the formatFullPrecision formatter for the
 * specified decimal precision.
 */
function fullPrecisionFormatter (prec: number, locales?: string | string[]) {
  return formatter(fullPrecisionFormatters, 0, prec, locales)
}

/*
 * fullPrecisionFormatter gets the formatFullPrecision formatter for the
 * specified decimal precision.
 */
function fullPrecisionFormatterWithPreservingZeroes (prec: number, locales?: string | string[]) {
  return formatter(fullPrecisionFormatters, prec, prec, locales)
}

/*
 * formatter gets the formatter from the supplied cache if it already exists,
 * else creates it.
 */
function formatter (formatters: Record<string, Intl.NumberFormat>, min: number, max: number, locales?: string | string[]): Intl.NumberFormat {
  const k = `${min}-${max}`
  let fmt = formatters[k]
  if (!fmt) {
    fmt = new Intl.NumberFormat(locales ?? languages, {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      useGrouping: false
    })
    formatters[k] = fmt
  }
  return fmt
}

/*
 * convertToConventional converts coin value in atomic units to conventional
 * units.
 */
function convertToConventional (v: number, unitInfo?: UnitInfo) {
  let prec = 8
  if (unitInfo) {
    const f = unitInfo.conventional.conversionFactor
    v /= f
    prec = Math.round(Math.log10(f))
  }
  return [v, prec]
}

/*
 * bestDisplayOrder is used in bestConversion, and is the order of magnitude
 * that is considered the best for display. For example, if bestDisplayOrder is
 * 1, and the choices for display are 1,000 BTC or 0.00001 Sats, the algorithm
 * will look at the orders of the conversions, 1000 => 10^3 => order 3, and
 * 0.00001 => 10^-5 => order 5, and see which is closest to bestDisplayOrder and
 * choose that conversion. In the example, 3 - bestDisplayOrder = 2 and
 * 1 - (-5) = 6, so the conversion that has the order closest to
 * bestDisplayOrder is the first one, 1,000 BTC.
 */
const bestDisplayOrder = 1 // 10^1 => 1

/*
 * resolveUnitConversions creates a lookup object mapping unit -> conversion
 * factor. By default, resolveUnitConversions only maps the atomic and
 * conventional units. If a prefs dict is provided, additional units can be
 * included.
 */
function resolveUnitConversions (ui: UnitInfo, prefs?: Record<string, boolean>): Record<string, number> {
  const unitFactors: Record<string, number> = {
    [ui.atomicUnit]: 1,
    [ui.conventional.unit]: ui.conventional.conversionFactor
  }
  if (ui.denominations && prefs) {
    for (const alt of ui.denominations) if (prefs[alt.unit]) unitFactors[alt.unit] = alt.conversionFactor
  }
  return unitFactors
}

// Helpers for working with the DOM.
export default class Doc {
  /*
   * idel is the element with the specified id that is the descendent of the
   * specified node.
   */
  static idel (el: Document | Element, id: string): HTMLElement {
    return el.querySelector(`#${id}`) as HTMLElement
  }

  /* bind binds the function to the event for the element. */
  static bind (el: EventTarget, ev: string | string[], f: EventListenerOrEventListenerObject, opts?: any /* EventListenerOptions */): void {
    for (const e of (Array.isArray(ev) ? ev : [ev])) el.addEventListener(e, f, opts)
  }

  /* unbind removes the handler for the event from the element. */
  static unbind (el: EventTarget, ev: string, f: (e: Event) => void): void {
    el.removeEventListener(ev, f)
  }

  /* noderize creates a Document object from a string of HTML. */
  static noderize (html: string): Document {
    return parser.parseFromString(html, 'text/html')
  }

  /*
   * mouseInElement returns true if the position of mouse event, e, is within
   * the bounds of the specified element or any of its descendents.
   */
  static mouseInElement (e: MouseEvent, el: HTMLElement): boolean {
    if (el.contains(e.target as Node)) return true
    const rect = el.getBoundingClientRect()
    return e.pageX >= rect.left && e.pageX <= rect.right &&
      e.pageY >= rect.top && e.pageY <= rect.bottom
  }

  /*
   * layoutMetrics gets information about the elements position on the page.
   */
  static layoutMetrics (el: HTMLElement): LayoutMetrics {
    const box = el.getBoundingClientRect()
    const docEl = document.documentElement
    const top = box.top + docEl.scrollTop
    const left = box.left + docEl.scrollLeft
    const w = el.offsetWidth
    const h = el.offsetHeight
    return {
      bodyTop: top,
      bodyLeft: left,
      width: w,
      height: h,
      centerX: left + w / 2,
      centerY: top + h / 2
    }
  }

  static descendentMetrics (parent: PageElement, kid: PageElement): LayoutMetrics {
    const parentMetrics = Doc.layoutMetrics(parent)
    const kidMetrics = Doc.layoutMetrics(kid)
    return {
      bodyTop: kidMetrics.bodyTop - parentMetrics.bodyTop,
      bodyLeft: kidMetrics.bodyLeft - parentMetrics.bodyLeft,
      width: kidMetrics.width,
      height: kidMetrics.height,
      centerX: kidMetrics.centerX - parentMetrics.bodyLeft,
      centerY: kidMetrics.centerY - parentMetrics.bodyTop
    }
  }

  /* empty removes all child nodes from the specified element. */
  static empty (...els: Element[]) {
    for (const el of els) while (el.firstChild) el.removeChild(el.firstChild)
  }

  /*
   * setContent removes all child nodes from the specified element and appends
   * passed elements.
   */
  static setContent (ancestor: PageElement, ...kids: PageElement[]) {
    Doc.empty(ancestor)
    for (const k of kids) ancestor.appendChild(k)
  }

  /*
   * hide hides the specified elements. This is accomplished by adding the
   * bootstrap d-hide class to the element. Use Doc.show to undo.
   */
  static hide (...els: Element[]) {
    for (const el of els) el.classList.add('d-hide')
  }

  /*
   * show shows the specified elements. This is accomplished by removing the
   * bootstrap d-hide class as added with Doc.hide.
   */
  static show (...els: Element[]) {
    for (const el of els) el.classList.remove('d-hide')
  }

  /*
   * showTemporarily shows the specified elements for the specified time, then
   * hides it again.
   */
  static showTemporarily (timeout: number, ...els: Element[]) {
    this.show(...els)
    setTimeout(() => {
      this.hide(...els)
    }, timeout)
  }

  /*
   * hidePreservingLayout hides the specified elements without affecting page layout
   * (like Doc.hide can). Use Doc.showPreservingLayout to undo.
   */
  static hidePreservingLayout (...els: HTMLElement[]) {
    for (const el of els) el.style.visibility = 'hidden'
  }

  /*
   * showPreservingLayout shows the specified elements, undoing changes by made with
   * Doc.hidePreservingLayout.
   */
  static showPreservingLayout (...els: HTMLElement[]) {
    for (const el of els) el.style.visibility = 'visible'
  }

  /*
   * show or hide the specified elements, based on value of the truthiness of
   * vis.
   */
  static setVis (vis: any, ...els: Element[]) {
    if (vis) Doc.show(...els)
    else Doc.hide(...els)
  }

  /* isHidden returns true if the specified element is hidden */
  static isHidden (el: Element): boolean {
    return el.classList.contains('d-hide')
  }

  /* isDisplayed returns true if the specified element is not hidden */
  static isDisplayed (el: Element): boolean {
    return !el.classList.contains('d-hide')
  }

  /*
   * animate runs the supplied function, which should be a "progress" function
   * accepting one argument. The progress function will be called repeatedly
   * with the argument varying from 0.0 to 1.0. The exact path that animate
   * takes from 0.0 to 1.0 will vary depending on the choice of easing
   * algorithm. See the Easing object for the available easing algo choices. The
   * default easing algorithm is linear.
   */
  static async animate (duration: number, f: (progress: number) => void, easingAlgo?: string) {
    await new Animation(duration, f, easingAlgo).wait()
  }

  static async blink (el: PageElement) {
    const [r, g, b] = State.isDark() ? [255, 255, 255] : [0, 0, 0]
    const cycles = 2
    Doc.animate(1000, (p: number) => {
      el.style.outline = `2px solid rgba(${r}, ${g}, ${b}, ${(cycles - p * cycles) % 1})`
    })
  }

  static applySelector (ancestor: HTMLElement, k: string): PageElement[] {
    return Array.from(ancestor.querySelectorAll(k)) as PageElement[]
  }

  static kids (ancestor: HTMLElement): PageElement[] {
    return Array.from(ancestor.children) as PageElement[]
  }

  static safeSelector (ancestor: HTMLElement, k: string): PageElement {
    const el = ancestor.querySelector(k)
    if (el) return el as PageElement
    console.warn(`no element found for selector '${k}' on element ->`, ancestor)
    return document.createElement('div')
  }

  /*
   * idDescendants creates an object mapping to elements which are descendants
   * of the ancestor and have id attributes. Elements are keyed by their id
   * value.
   */
  static idDescendants (ancestor: HTMLElement): Record<string, PageElement> {
    const d: Record<string, PageElement> = {}
    for (const el of Doc.applySelector(ancestor, '[id]')) d[el.id] = el
    return d
  }

  /*
   * capNumberStr caps number string at maxDigits by trimming least-significant digits.
   */
  static capNumberStr (numberStr: string, maxDigits: number): string {
    if (numberStr.length <= maxDigits) {
      return numberStr
    }
    return numberStr.substring(0, maxDigits)
  }

  /*
   * formatCoinAtom formats the value in atomic units into a string
   * representation in conventional units. If the value happens to be an
   * integer, no decimals are displayed. Trailing zeros may be truncated.
   * By default full precision of unitInfo will be used, but `precision`
   * parameter allows for specifying the desired one (note, `precision` is
   * max number of significant digits after decimal point).
   */
  static formatCoinAtom (coinAtom: number, unitInfo?: UnitInfo, precision?: number): string {
    const [v, precisionFull] = convertToConventional(coinAtom, unitInfo)
    if (Number.isInteger(v)) return intFormatter.format(v)
    if (!precision) {
      precision = precisionFull
    }
    return fullPrecisionFormatter(precision).format(v)
  }

  /*
   * formatCoinAtomToLotSizeBaseCurrency formats atomic coin value to represent it exactly
   * at lot size precision (corresponds to base currency).
   */
  static formatCoinAtomToLotSizeBaseCurrency (coinAtom: number, bui: UnitInfo, lotSizeAtom: number): string {
    const [coin] = convertToConventional(coinAtom, bui)
    const [lotSize] = convertToConventional(lotSizeAtom, bui) // lot size is in base units
    const lotSizeDigits = -(Math.floor(Math.log10(lotSize)))
    if (lotSizeDigits <= 0) {
      // no decimals, display as integer then
      return intFormatter.format(coin)
    }
    return fullPrecisionFormatterWithPreservingZeroes(lotSizeDigits).format(coin)
  }

  /*
   * formatCoinAtomToLotSizeQuoteCurrency formats atomic coin value to represent it exactly
   * at lot size precision that would correspond to quote currency.
   */
  static formatCoinAtomToLotSizeQuoteCurrency (coinAtom: number, bui: UnitInfo, qui: UnitInfo, lotSizeAtom: number, rateStepAtom: number): string {
    const [coin] = convertToConventional(coinAtom, qui)
    const [lotSize] = convertToConventional(lotSizeAtom, bui) // lot size is in base units
    const lotSizeDigits = -(Math.floor(Math.log10(lotSize)))
    const rateStepDigits = log10RateEncodingFactor - Math.floor(Math.log10(rateStepAtom)) -
        Math.floor(Math.log10(bui.conventional.conversionFactor) - Math.log10(qui.conventional.conversionFactor))
    if (lotSizeDigits + rateStepDigits <= 0) {
      // no decimals, display as integer then
      return intFormatter.format(coin)
    }
    return fullPrecisionFormatterWithPreservingZeroes(lotSizeDigits + rateStepDigits).format(coin)
  }

  // adjRateAtomsBuy helps us make sure every order-rate we've got is adjusted to rate-step,
  // this is redundant but helps with the hack we do to keep rates manageable in UI
  // (see comment that mentions "insanely large rate-step"); note, we have to round
  // buy-order rate DOWN (and sell-order rate UP) so that user can actually target it by
  // placing an order in UI with the price that will match the order he sees in order-book
  // (otherwise he'll be just short of the rate he needs to set)
  // these rate adjustments here
  static adjRateAtomsBuy (rateAtom: number, rateStepAtom: number): number {
    return rateAtom - (rateAtom % rateStepAtom) // adjusted down
  }

  // adjRateAtomsSell is similar to adjRateAtomsBuy but for sell-orders
  static adjRateAtomsSell (rateAtom: number, rateStepAtom: number): number {
    const adjustedRateAtom = rateAtom - (rateAtom % rateStepAtom)
    if (rateAtom === adjustedRateAtom) {
      return rateAtom // nothing to adjust up
    }
    return adjustedRateAtom + rateStepAtom // adjusted up
  }

  /*
   * formatRateAtomToRateStep formats atomic rate value to represent it exactly at rate step
   * precision (rounding up or down depending on the value of sell parameter, down by default).
   */
  static formatRateAtomToRateStep (rateAtom: number, bui: UnitInfo, qui: UnitInfo, rateStepAtom: number, sell?: boolean): string {
    // adjust rate based on whether it belongs to buy or sell order in Bison order book, make
    // this adjustment not only when displaying rates in order-book but also at every other
    // place where Bison rate might be displayed (open/completed orders, matches history, ...)
    // so that the numbers are consistent everywhere for the same order - hence we are doing it
    // here in formatRateAtomToRateStep;
    // note, sell parameter is optional since there are a bunch of places that don't care about
    // it but still rely on this function to format rate (for one reason or another) - in case
    // it is omitted it's fine to treat it as buy-order
    const rateAtomAdj = sell ? Doc.adjRateAtomsSell(rateAtom, rateStepAtom) : Doc.adjRateAtomsBuy(rateAtom, rateStepAtom)

    const r = bui.conventional.conversionFactor / qui.conventional.conversionFactor
    const rateConv = rateAtomAdj * (r / RateEncodingFactor)
    return Doc.formatRateToRateStep(rateConv, bui, qui, rateStepAtom)
  }

  /*
   * formatRateToRateStep formats conventional rate value to represent it exactly at rate step
   * precision (rounding down when necessary).
   */
  static formatRateToRateStep (rateConv: number, bui: UnitInfo, qui: UnitInfo, rateStepAtom: number): string {
    const rateStepDigits = log10RateEncodingFactor - Math.floor(Math.log10(rateStepAtom)) -
        Math.floor(Math.log10(bui.conventional.conversionFactor) - Math.log10(qui.conventional.conversionFactor))
    if (rateStepDigits <= 0) {
      // no decimals, display as integer then
      return intFormatter.format(rateConv)
    }
    return fullPrecisionFormatterWithPreservingZeroes(rateStepDigits).format(rateConv)
  }

  /*
   * formatBestWeCan formats number n to the best of its ability to keep it short
   * sacrificing as little precision as possible.
   */
  static formatBestWeCan (n: number, maxDecimals?: number): string {
    if (n >= 1000) {
      // for large numbers don't want to show decimals, might as well format as integer
      return intFormatter.format(n)
    }
    if (!maxDecimals) {
      // since maxDecimals is not specified formatting with fourSigFigs is the best
      // guess we'll go with
      return fourSigFigs.format(n)
    }
    // otherwise it's best to format with full precision up to maxDecimals
    return fullPrecisionFormatter(maxDecimals).format(n)
  }

  static formatInt (i: number): string {
    return intFormatter.format(i)
  }

  /*
   * formatFullPrecision formats the value in atomic units into a string
   * representation in conventional units using the full decimal precision
   * associated with the conventional unit's conversion factor.
   */
  static formatFullPrecision (vAtomic: number, unitInfo?: UnitInfo): string {
    const [v, prec] = convertToConventional(vAtomic, unitInfo)
    return fullPrecisionFormatter(prec).format(v)
  }

  /*
   * formatFiatConversion formats the value in atomic units to its representation in
   * conventional units and returns the fiat value as a string.
   */
  static formatFiatConversion (vAtomic: number, rate: number, unitInfo?: UnitInfo): string {
    if (!rate || rate === 0) return intl.prep(intl.ID_UNAVAILABLE)
    const prec = 2
    const [v] = convertToConventional(vAtomic, unitInfo)
    const value = v * rate
    return fullPrecisionFormatter(prec).format(value)
  }

  static languages (): string[] {
    return languages
  }

  static formatFiatValue (value: number): string {
    return fullPrecisionFormatterWithPreservingZeroes(2).format(value)
  }

  static formatOneDecimalPrecision (value: number): string {
    return fullPrecisionFormatterWithPreservingZeroes(1).format(value)
  }

  /*
   * bestConversion picks the best conversion factor for the atomic value. The
   * best is the one in which log10(converted_value) is closest to
   * bestDisplayOrder. Return: [converted_value, precision, unit].
   */
  static bestConversion (atoms: number, ui: UnitInfo, prefs?: Record<string, boolean>): [number, number, string] {
    const unitFactors = resolveUnitConversions(ui, prefs)
    const logDiffs: [string, number][] = []
    const entryDiff = (entry: [string, number]) => Math.abs(Math.log10(atoms / entry[1]) - bestDisplayOrder)
    for (const entry of Object.entries(unitFactors)) logDiffs.push([entry[0], entryDiff(entry)])
    const best = logDiffs.reduce((best: [string, number], entry: [string, number]) => entry[1] < best[1] ? entry : best)
    const unit = best[0]
    const cFactor = unitFactors[unit]
    const v = atoms / cFactor
    return [v, Math.round(Math.log10(cFactor)), unit]
  }

  /*
   * formatBestUnitsFullPrecision formats the value with the best choice of
   * units, at full precision.
   */
  static formatBestUnitsFullPrecision (atoms: number, ui: UnitInfo, prefs?: Record<string, boolean>): [string, string] {
    const [v, prec, unit] = this.bestConversion(atoms, ui, prefs)
    if (Number.isInteger(v)) return [intFormatter.format(v), unit]
    return [fullPrecisionFormatter(prec).format(v), unit]
  }

  /*
   * formatBestUnitsFourSigFigs formats the value with the best choice of
   * units and rounded to four significant figures.
   */
  static formatBestUnitsFourSigFigs (atoms: number, ui: UnitInfo, prefs?: Record<string, boolean>): [string, string] {
    const [v, prec, unit] = this.bestConversion(atoms, ui, prefs)
    return [Doc.formatBestWeCan(v, prec), unit]
  }

  /*
   * formatBestRateElement formats a rate using the best available units and
   * updates the UI element. The ancestor should have descendents with data
   * attributes [best-value, data-unit, data-unit-box, data-denom].
   */
  static formatBestRateElement (ancestor: PageElement, assetID: number, atoms: number, ui: UnitInfo, prefs?: Record<string, boolean>) {
    Doc.formatBestValueElement(ancestor, assetID, atoms, ui, prefs)
    Doc.setText(ancestor, '[data-denom]', ui.feeRateDenom)
  }

  /*
   * formatBestRateElement formats a value using the best available units and
   * updates the UI element. The ancestor should have descendents with data
   * attributes [best-value, data-unit, data-unit-box].
   */
  static formatBestValueElement (ancestor: PageElement, assetID: number, atoms: number, ui: UnitInfo, prefs?: Record<string, boolean>) {
    const [v, unit] = this.formatBestUnitsFourSigFigs(atoms, ui, prefs)
    Doc.setText(ancestor, '[data-value]', v)
    Doc.setText(ancestor, '[data-unit]', unit)
    const span = Doc.safeSelector(ancestor, '[data-unit-box]')
    span.dataset.atoms = String(atoms)
    span.dataset.assetID = String(assetID)
  }

  static conventionalRateStep (rateStepEnc: number, baseUnitInfo: UnitInfo, quoteUnitInfo: UnitInfo) {
    const [qFactor, bFactor] = [quoteUnitInfo.conventional.conversionFactor, baseUnitInfo.conventional.conversionFactor]
    return (rateStepEnc / RateEncodingFactor) * (bFactor / qFactor)
  }

  /*
   * logoPath creates a path to a png logo for the specified ticker symbol. If
   * the symbol is not a supported asset, the generic letter logo will be
   * requested instead.
   */
  static logoPath (symbol: string): string {
    if (BipSymbols.indexOf(symbol) === -1) symbol = symbol.substring(0, 1)
    symbol = symbol.split('.')[0] // e.g. usdc.eth => usdc
    return `/img/coins/${symbol}.png`
  }

  static bipSymbol (assetID: number): string {
    return BipIDs[assetID]
  }

  static bipIDFromSymbol (symbol: string): number {
    return BipSymbolIDs[symbol]
  }

  static bipCEXSymbol (assetID: number): string {
    const bipSymbol = BipIDs[assetID]
    if (!bipSymbol || bipSymbol === '') return ''
    const parts = bipSymbol.split('.')
    if (parts[0] === 'weth') return 'eth'
    return parts[0]
  }

  static logoPathFromID (assetID: number): string {
    return Doc.logoPath(BipIDs[assetID])
  }

  /*
   * symbolize creates a token-aware symbol element for the asset's symbol. For
   * non-token assets, this is simply a <span>SYMBOL</span>. For tokens, it'll
   * be <span><span>SYMBOL</span><sup>PARENT</sup></span>.
   */
  static symbolize (asset: Symbolizer, useLogo?: boolean): PageElement {
    const ticker = asset.unitInfo.conventional.unit
    const symbolSpan = document.createElement('span')
    symbolSpan.textContent = ticker.toUpperCase()
    const parts = asset.symbol.split('.')
    const isToken = parts.length === 2
    if (!isToken) return symbolSpan
    const parentSymbol = parts[1]
    const span = document.createElement('span')
    span.appendChild(symbolSpan)
    if (useLogo) {
      const parentLogo = document.createElement('img')
      parentLogo.src = Doc.logoPath(parentSymbol)
      parentLogo.classList.add('token-parent')
      span.appendChild(parentLogo)
      return span
    }
    const parentSup = document.createElement('sup')
    parentSup.textContent = parentSymbol.toUpperCase()
    parentSup.classList.add('token-parent')
    span.appendChild(parentSup)
    return span
  }

  /*
   * shortSymbol removes the short format of a symbol, with any parent chain
   * identifier removed
   */
  static shortSymbol (symbol: string): string {
    return symbol.split('.')[0].toUpperCase()
  }

  /*
   * setText sets the textContent for all descendant elements that match the
   * specified CSS selector.
   */
  static setText (ancestor: PageElement, selector: string, textContent: string) {
    for (const el of Doc.applySelector(ancestor, selector)) el.textContent = textContent
  }

  static setSrc (ancestor: PageElement, selector: string, textContent: string) {
    for (const img of Doc.applySelector(ancestor, selector)) img.src = textContent
  }

  /*
  * cleanTemplates removes the elements from the DOM and deletes the id
  * attribute.
  */
  static cleanTemplates (...tmpls: HTMLElement[]) {
    tmpls.forEach(tmpl => {
      tmpl.remove()
      tmpl.removeAttribute('id')
    })
  }

  /*
  * tmplElement is a helper function for grabbing sub-elements of the market list
  * template.
  */
  static tmplElement (ancestor: Document | HTMLElement, s: string): PageElement {
    return ancestor.querySelector(`[data-tmpl="${s}"]`) || document.createElement('div')
  }

  /*
  * parseTemplate returns an object of data-tmpl elements, keyed by their
  * data-tmpl values.
  */
  static parseTemplate (ancestor: HTMLElement): Record<string, PageElement> {
    const d: Record<string, PageElement> = {}
    for (const el of Doc.applySelector(ancestor, '[data-tmpl]')) d[el.dataset.tmpl || ''] = el
    return d
  }

  /*
   * timeFromMs returns a string representation of the timestamp specified
   * as unix timestamp (milliseconds) formatted as hh:mm:ss.
   */
  static timeFromMs (ms: number): string {
    const date = new Date(ms)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  }

  /*
   * ageSinceFromMs returns a string representation of the duration since the
   * specified unix timestamp (milliseconds).
   */
  static ageSinceFromMs (ms: number, trimSeconds?: boolean): string {
    return Doc.formatDuration((new Date().getTime()) - ms, trimSeconds)
  }

  /*
   * hmsSinceFromS returns a time duration since the specified unix timestamp
   * formatted as hh:mm:ss.
   */
  static hmsSinceFromS (secs: number): string {
    let r = (new Date().getTime() / 1000) - secs
    const h = String(Math.floor(r / 3600))
    r = r % 3600
    const m = String(Math.floor(r / 60))
    const s = String(Math.floor(r % 60))
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`
  }

  /*
   * hmsSinceFromMs is same as hmsSinceFromS for milliseconds.
   */
  static hmsSinceFromMs (ms: number): string {
    return Doc.hmsSinceFromS(ms / 1000)
  }

  /*
   * hmsSinceFromS returns a time duration since the specified unix timestamp
   * formatted as YYYY/MM/DD hh:mm.
   */
  static ymdhmSinceFromMS (ms: number): string {
    const date = new Date(ms)
    const year = String(date.getFullYear())
    const month = String(date.getMonth() + 1).padStart(2, '0') // JS enumerates months as 0-11
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}/${month}/${day} ${hours}:${minutes}`
  }

  /* formatDuration returns a string representation of the duration */
  static formatDuration (dur: number, trimSeconds?: boolean): string {
    let seconds = Math.floor(dur)
    let result = ''
    // significantChunkCnt counts how many chunks (year, month, day, hour, minute) we've added to the result.
    let significantChunkCnt = 0
    const add = (n: number, s: string): boolean => {
      if (n === 0 && significantChunkCnt === 0) {
        // we haven't started building the result, so we aren't done yet
        return false
      }
      significantChunkCnt++
      let chunk = `${n}${s} `
      if (n < 10) {
        // gotta pad 1-digit number chunk so that it occupies the same amount of space as 2-digit chunk
        chunk = ' ' + chunk // use a space that's of the same size as a digit
      }
      result += chunk
      return significantChunkCnt >= 2 // we want to show 2 chunks (year, month, day, hour, minute) at most
    }

    const aYear = 31536000000
    const aMonth = 2592000000
    const aDay = 86400000
    const anHour = 3600000
    const aMinute = 60000
    const aSecond = 1000

    let Y, M, D, h, m, s
    [Y, seconds] = timeMod(seconds, aYear)
    if (add(Y, 'y')) { return result }
    [M, seconds] = timeMod(seconds, aMonth)
    if (add(M, 'm')) { return result }
    [D, seconds] = timeMod(seconds, aDay)
    if (add(D, 'd')) { return result }
    [h, seconds] = timeMod(seconds, anHour)
    if (add(h, 'h')) { return result }
    if (trimSeconds) {
      // show minutes chunk and be done with it
      [m, seconds] = timeMod(seconds, aMinute)
      add(m, 'm')
      return result || '0m'
    }
    // show both minutes and seconds chunks then
    [m, seconds] = timeMod(seconds, aMinute)
    if (add(m, 'm')) { return result }
    [s, seconds] = timeMod(seconds, aSecond)
    add(s, 's')
    return result || '0s'
  }

  // showFormError can be used to set and display error message on forms.
  static showFormError (el: PageElement, msg: any) {
    el.textContent = msg
    Doc.show(el)
  }

  // showFiatValue displays the fiat equivalent for the provided amount.
  static showFiatValue (display: PageElement, amount: number, rate: number, ui: UnitInfo): void {
    if (rate) {
      display.textContent = Doc.formatFiatConversion(amount, rate, ui)
      Doc.show(display.parentElement as Element)
    } else Doc.hide(display.parentElement as Element)
  }
}

/*
 * Animation is a handler for starting and stopping animations.
 */
export class Animation {
  done: (() => void) | undefined
  endAnimation: boolean
  thread: Promise<void>
  static Forever: number

  constructor (duration: number, f: (progress: number) => void, easingAlgo?: string, done?: () => void) {
    this.done = done
    this.thread = this.run(duration, f, easingAlgo)
  }

  /*
   * run runs the animation function, increasing progress from 0 to 1 in a
   * manner dictated by easingAlgo.
   */
  async run (duration: number, f: (progress: number) => void, easingAlgo?: string) {
    duration = duration >= 0 ? duration : 1000 * 86400 * 365 * 10 // 10 years, in ms
    const easer = easingAlgo ? Easing[easingAlgo] : Easing.linear
    const start = new Date().getTime()
    const end = (duration === Animation.Forever) ? Number.MAX_SAFE_INTEGER : start + duration
    const range = end - start
    const frameDuration = 1000 / FPS
    let now = start
    this.endAnimation = false
    while (now < end) {
      if (this.endAnimation) return this.runCompletionFunction()
      f(easer((now - start) / range))
      await sleep(frameDuration)
      now = new Date().getTime()
    }
    f(1)
    return this.runCompletionFunction()
  }

  /* wait returns a promise that will resolve when the animation completes. */
  async wait () {
    await this.thread
  }

  /* stop schedules the animation to exit at its next frame. */
  stop () {
    this.endAnimation = true
  }

  /*
   * stopAndWait stops the animations and returns a promise that will resolve
   * when the animation exits.
   */
  async stopAndWait () {
    this.stop()
    await this.wait()
  }

  /* runCompletionFunction runs any registered callback function */
  runCompletionFunction () {
    if (this.done) this.done()
  }
}
Animation.Forever = -1

/* Easing algorithms for animations. */
export const Easing: Record<string, (t: number) => number> = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => t * (2 - t),
  easeInHard: t => t * t * t,
  easeOutHard: t => (--t) * t * t + 1,
  easeOutElastic: t => {
    const c4 = (2 * Math.PI) / 3
    return t === 0
      ? 0
      : t === 1
        ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
  }
}

/*
 * AniToggle is a small toggle switch, defined in HTML with the element
 * <div class="anitoggle"></div>. The animations are defined in the anitoggle
 * CSS class. AniToggle triggers the callback on click events, but does not
 * update toggle appearance, so the caller must call the setState method from
 * the callback or elsewhere if the newState
 * is accepted.
 */
export class AniToggle {
  toggle: PageElement
  toggling: boolean

  constructor (toggle: PageElement, errorEl: PageElement, initialState: boolean, callback: (newState: boolean) => Promise<any>) {
    this.toggle = toggle
    if (toggle.children.length === 0) toggle.appendChild(document.createElement('div'))

    Doc.bind(toggle, 'click', async (e: MouseEvent) => {
      e.stopPropagation()
      Doc.hide(errorEl)
      const newState = !toggle.classList.contains('on')
      this.toggling = true
      try {
        await callback(newState)
      } catch (e) {
        this.toggling = false
        Doc.show(errorEl)
        errorEl.textContent = intl.prep(intl.ID_API_ERROR, { msg: e.msg || String(e) })
        return
      }
      this.toggling = false
    })
    this.setState(initialState)
  }

  setState (state: boolean) {
    if (state) this.toggle.classList.add('on')
    else this.toggle.classList.remove('on')
  }
}

/* sleep can be used by async functions to pause for a specified period. */
function sleep (ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/* timeMod returns the quotient and remainder of t / dur. */
function timeMod (t: number, dur: number) {
  const n = Math.floor(t / dur)
  return [n, t - n * dur]
}

if (process.env.NODE_ENV === 'development') {
  window.testFormatRateAtomToRateStep = () => {
    const tests: [number, number, number, number, string][] = [
      // Two utxo assets with a conventional rate of 0.15. Conventional rate
      // step is 100 / 1e8 = 1e-6, so there should be 6 decimal digits.
      [1.5e7, 100, 1e8, 1e8, '0.150000'],
      // USDC quote -> utxo base with a rate of $10 / 1 XYZ. USDC has an
      // conversion factor of 1e6, so $10 encodes to 1e7, 1 XYZ encodes to 1e8,
      // encoded rate is 1e7 / 1e8 * 1e8 = 1e7, bFactor / qFactor is 1e2.
      // The conventional rate step is 200 / 1e8 * 1e2 = 2e-4, so using
      // rateStepDigits, we should get 4 decimal digits.
      [1e7, 200, 1e6, 1e8, '10.0000'],
      // Set a rate of 1 atom USDC for 0.01 BTC. That atomic rate will be 1 /
      // 1e6 = 1e-6. The encoded rate will be 1e-6 * 1e8 = 1e2. As long as our
      // rate step divides evenly into 100, this should work. The conventional
      // rate is 1e-6 / 1e-2 = 1e-4, so expect 4 decimal digits.
      [1e2, 100, 1e6, 1e8, '0.0001'],
      // DCR-ETH, expect 6 decimals.
      [1.5e7, 1000, 1e9, 1e8, '0.015000'],
      [1e6, 1000, 1e9, 1e8, '0.001000'],
      [1e3, 1000, 1e9, 1e8, '0.000001'],
      [100001000, 1000, 1e9, 1e8, '0.100001'],
      [1000001000, 1000, 1e9, 1e8, '1.000001'],
      // DCR-USDC, expect 3 decimals.
      [1.5e7, 1000, 1e6, 1e8, '15.000'],
      [1e6, 1000, 1e6, 1e8, '1.000'],
      [1e3, 1000, 1e6, 1e8, '0.001'],
      [101000, 1000, 1e6, 1e8, '0.101'],
      [1001000, 1000, 1e6, 1e8, '1.001'],
      // UTXO assets but with a rate step that's not a perfect power of 10.
      // For a rate step of 500, a min rate would be e.g. rate step = 500.
      // 5e2 / 1e8 = 5e-6 = 0.000005
      [5e2, 500, 1e8, 1e8, '0.000005']
    ]

    for (const [encRate, rateStep, qFactor, bFactor, expEncoding] of tests) {
      for (const k in fullPrecisionFormatters) delete fullPrecisionFormatters[k] // cleanup
      const bui = { conventional: { conversionFactor: bFactor } } as any as UnitInfo
      const qui = { conventional: { conversionFactor: qFactor } } as any as UnitInfo
      const enc = Doc.formatRateAtomToRateStep(encRate, bui, qui, rateStep)
      if (enc !== expEncoding) console.log(`TEST FAILED: f(${encRate}, ${bFactor}, ${qFactor}, ${rateStep}) => ${enc} != ${expEncoding}`)
      else console.log(`✔️ f(${encRate}, ${bFactor}, ${qFactor}, ${rateStep}) => ${enc} ✔️`)
    }
  }
}

export interface NumberInputOpts {
  prec?: number
  sigFigs?: boolean
  changed?: (v: number) => void
  min?: number
  set?: (v: number, s: string) => void // called when setValue is called
}

export class NumberInput {
  input: PageElement
  prec: number
  fmt: (v: number, prec: number) => [number, string]
  changed: (v: number) => void
  set?: (v: number, s: string) => void
  min: number

  constructor (input: PageElement, opts: NumberInputOpts) {
    this.input = input
    this.prec = opts.prec ?? 0
    this.fmt = opts.sigFigs ? toFourSigFigs : toPrecision
    this.changed = opts.changed ?? (() => { /* pass */ })
    this.set = opts.set
    this.min = opts.min ?? 0

    Doc.bind(input, 'change', () => { this.inputChanged() })
  }

  inputChanged () {
    const { changed } = this
    if (changed) changed(this.value())
  }

  setValue (v: number) {
    this.input.value = String(v)
    v = this.value()
    if (this.set) this.set(v, this.input.value)
  }

  value () {
    const { input, min, prec, fmt } = this
    const rawV = Math.max(parseFloatDefault(input.value, min ?? 0), min ?? 0)
    const [v, s] = fmt(rawV, prec ?? 0)
    input.value = s
    return v
  }
}

export interface IncrementalInputOpts extends NumberInputOpts {
  inc?: number
}

export class IncrementalInput extends NumberInput {
  inc: number
  opts: IncrementalInputOpts

  constructor (box: PageElement, opts: IncrementalInputOpts) {
    super(Doc.safeSelector(box, 'input'), opts)
    this.opts = opts
    this.inc = opts.inc ?? 1

    const up = Doc.safeSelector(box, '.ico-arrowup')
    const down = Doc.safeSelector(box, '.ico-arrowdown')

    Doc.bind(up, 'click', () => { this.increment(1) })
    Doc.bind(down, 'click', () => { this.increment(-1) })
  }

  setIncrementAndMinimum (inc: number, min: number) {
    this.inc = inc
    this.min = min
  }

  increment (sign: number) {
    const { inc, min, input } = this
    input.value = String(Math.max(this.value() + sign * inc, min))
    this.inputChanged()
  }
}

export class MiniSlider {
  track: PageElement
  ball: PageElement
  r: number
  changed: (r: number) => void

  constructor (box: PageElement, changed: (r: number) => void) {
    this.changed = changed
    this.r = 0

    const color = document.createElement('div')
    color.dataset.tmpl = 'color'
    box.appendChild(color)
    const track = this.track = document.createElement('div')
    track.dataset.tmpl = 'track'
    color.appendChild(track)
    const ball = this.ball = document.createElement('div')
    ball.dataset.tmpl = 'ball'
    track.appendChild(ball)

    Doc.bind(box, 'mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const startX = e.pageX
      const w = track.clientWidth
      const startLeft = this.r * w
      const left = (ee: MouseEvent) => Math.max(Math.min(startLeft + (ee.pageX - startX), w), 0)
      const trackMouse = (ee: MouseEvent) => {
        ee.preventDefault()
        const l = left(ee)
        this.r = l / w
        ball.style.left = `${this.r * 100}%`
        this.changed(this.r)
      }
      const mouseUp = (ee: MouseEvent) => {
        trackMouse(ee)
        Doc.unbind(document, 'mousemove', trackMouse)
        Doc.unbind(document, 'mouseup', mouseUp)
      }
      Doc.bind(document, 'mousemove', trackMouse)
      Doc.bind(document, 'mouseup', mouseUp)
    })

    Doc.bind(box, 'click', (e: MouseEvent) => {
      if (e.button !== 0) return
      const x = e.pageX
      const m = Doc.layoutMetrics(track)
      this.r = clamp((x - m.bodyLeft) / m.width, 0, 1)
      ball.style.left = `${this.r * m.width}px`
      this.changed(this.r)
    })
  }

  setValue (r: number) {
    this.r = clamp(r, 0, 1)
    this.ball.style.left = `${this.r * 100}%`
  }
}

export function toPrecision (v: number, prec: number): [number, string] {
  const ord = Math.pow(10, prec ?? 0)
  v = Math.round(v * ord) / ord
  let s = v.toFixed(prec)
  if (prec > 0) {
    while (s.endsWith('0')) s = s.substring(0, s.length - 1)
    if (s.endsWith('.')) s = s.substring(0, s.length - 1)
  }
  return [v, s]
}

export function toFourSigFigs (v: number, maxPrec: number): [number, string] {
  const ord = Math.floor(Math.log10(Math.abs(v)))
  if (ord >= 3) return [Math.round(v), v.toFixed(0)]
  const prec = Math.min(4 - ord, maxPrec)
  return toPrecision(v, prec)
}

export function parseFloatDefault (inputValue: string | undefined, defaultValue?: number) {
  const v = parseFloat((inputValue ?? '').replace(/,/g, ''))
  if (!isNaN(v)) return v
  return defaultValue ?? 0
}

/* clamp returns v if min <= v <= max, else min or max. */
export function clamp (v: number, min: number, max: number): number {
  if (v < min) return min
  if (v > max) return max
  return v
}

export async function setupCopyBtn (txt: string, textEl: PageElement, btnEl: PageElement, color: string) {
  try {
    await navigator.clipboard.writeText(txt)
  } catch (err) {
    console.error('Unable to copy: ', err)
  }
  const textOriginalColor = textEl.style.color
  const btnOriginalColor = btnEl.style.color
  textEl.style.color = color
  btnEl.style.color = color
  setTimeout(() => {
    textEl.style.color = textOriginalColor
    btnEl.style.color = btnOriginalColor
  }, 350)
}
