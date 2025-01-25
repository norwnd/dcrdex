import Doc, { Animation } from './doc'
import State from './state'
import BasePage from './basepage'
import OrderBook from './orderbook'
import { ReputationMeter, tradingLimits, strongTier } from './account'
import {
  CandleChart,
  CandleReporters,
  Wave
} from './charts'
import { postJSON } from './http'
import {
  NewWalletForm,
  DepositAddress,
  TokenApprovalForm,
  bind as bindForm,
  Forms
} from './forms'
import * as OrderUtil from './orderutil'
import ws from './ws'
import * as intl from './locales'
import {
  app,
  ApprovalStatus,
  Asset,
  BalanceNote,
  BondNote,
  BookUpdate,
  Candle,
  CandlesPayload,
  ConnectionStatus,
  ConnEventNote,
  EpochNote,
  Exchange,
  Market, MarketOrderBook,
  MatchNote,
  MaxOrderEstimate,
  MiniOrder,
  Order, OrderFilter,
  OrderNote,
  PageElement,
  RecentMatch,
  RemainderUpdate,
  SpotPriceNote,
  SupportedAsset,
  TradeForm,
  UnitInfo,
  WalletStateNote
} from './registry'
import { setOptionTemplates } from './opts'

const bind = Doc.bind

const bookRoute = 'book'
const bookOrderRoute = 'book_order'
const unbookOrderRoute = 'unbook_order'
const updateRemainingRoute = 'update_remaining'
const epochOrderRoute = 'epoch_order'
const candlesRoute = 'candles'
const candleUpdateRoute = 'candle_update'
const unmarketRoute = 'unmarket'
const epochMatchSummaryRoute = 'epoch_match_summary'

const animationLength = 500

const maxRecentlyActiveUserOrdersShown = 8
const maxCompletedUserOrdersShown = 100

// orderBookSideMaxCapacity defines how many orders in the book side will be displayed
const orderBookSideMaxCapacity = 13

const buyBtnClass = 'buygreen-bg'
const sellBtnClass = 'sellred-bg'

const candleBinKey5m = '5m'
const candleBinKey24h = '24h'

const completedOrderHistoryDurationHide = 'hide'
const completedOrderHistoryDuration1d = '1 day'
const completedOrderHistoryDuration1w = '1 week'
const completedOrderHistoryDuration1m = '1 month'
const completedOrderHistoryDuration3m = '3 month'

interface MetaOrder {
  div: HTMLElement
  header: Record<string, PageElement>
  details: Record<string, PageElement>
  ord: Order
  cancelling?: boolean
}

interface CancelData {
  bttn: PageElement
  order: Order
}

interface CurrentMarket {
  dex: Exchange
  name: string // A string market identifier used by the DEX.
  cfg: Market
  base: SupportedAsset
  quote: SupportedAsset
  baseUnitInfo: UnitInfo
  quoteUnitInfo: UnitInfo
  // maxSell is a cached max order estimate, unlike with buy-orders, for sell-orders
  // max doesn't depend on chosen rate
  maxSell: MaxOrderEstimate | null
  // sellBalance helps to track when we want to update our maxSell estimate, for example
  // when wallet balance updates
  sellBalance: number
  // buyBalance helps to track when we want to update our maxBuys estimates, for example
  // when wallet balance updates
  buyBalance: number
  // maxBuys is cached max order estimates (rateAtom -> estimateAtom), these depend on user-chosen rate
  maxBuys: Record<number, MaxOrderEstimate>
  candleCaches: Record<string, CandlesPayload>
  baseCfg: Asset
  quoteCfg: Asset
  rateConversionFactor: number
  bookLoaded: boolean
}

interface OrderRow extends HTMLElement {
  manager: OrderTableRowManager
}

interface StatsDisplay {
  htmlElem: PageElement
  tmpl: Record<string, PageElement>
}

interface MarketsPageParams {
  host: string
  baseID: string
  quoteID: string
}

export default class MarketsPage extends BasePage {
  page: Record<string, PageElement>
  main: HTMLElement
  // chosenRateBuyAtom of non-0 value represents successfully parsed user-chosen exchange
  // rate (the freshest one) in atoms for buy-order. Note, this is always a value already
  // adjusted to rate-step. 0 value indicates there is no such rate available for whatever
  // reason (for example, if user typed in some garbage).
  chosenRateBuyAtom: number
  // chosenRateSellAtom is same as chosenRateBuyAtom for sell-order.
  chosenRateSellAtom: number
  // chosenQtyBuy is same as chosenRateBuyAtom for order quantity for buy-order (adjusted
  // for lot size). Always in Base asset units.
  chosenQtyBuyAtom: number
  // chosenQtySell is same as chosenQtyBuy for sell-order. Always in Base asset units.
  chosenQtySellAtom: number
  // maxBuyLastReqID helps us track the IDs of /maxbuy requests issued, it's
  // hard to prevent our app (and the user) from sending multiple of these
  // requests in parallel, so instead we keep track of all requests we've issued
  // and make use of the result from latest one.
  maxBuyLastReqID: number
  // maxSellLastReqID same as maxBuyLastReqID but for /maxsell requests.
  maxSellLastReqID: number
  verifiedOrder: TradeForm
  market: CurrentMarket
  openAsset: SupportedAsset
  currentCreate: SupportedAsset
  book: OrderBook
  cancelData: CancelData
  recentlyActiveUserOrders: Record<string, MetaOrder>
  // actionInflightCompletedOrderHistory helps coordinate which completed order history (what
  // duration) will be displayed in UI with respect to what user actually chose
  actionInflightCompletedOrderHistory: boolean
  hovers: HTMLElement[]
  ogTitle: string
  candleChart: CandleChart // reused across different markets
  // reqCandleDuration is used to differentiate between ws responses coming as a results of requests
  // with different durations, note - that only covers the most common case of concurrent candles
  // request(s), if racy concurrent candles requests prove to be a problem in practice we'll need
  // to add a request ID that would allow to only apply the results of the latest request.
  reqCandleDuration: string
  marketList: MarketList
  newWalletForm: NewWalletForm
  depositAddrForm: DepositAddress
  approveTokenForm: TokenApprovalForm
  reputationMeter: ReputationMeter
  keyup: (e: KeyboardEvent) => void
  secondTicker: number
  // recentMatches contains matches made on the currently chosen market
  recentMatches: RecentMatch[]
  recentMatchesSortKey: string
  recentMatchesSortDirection: 1 | -1
  stats: StatsDisplay
  loadingAnimations: { candles?: Wave }
  runningErrAnimations: Animation[]
  forms: Forms
  constructor (main: HTMLElement, pageParams: MarketsPageParams) {
    super()

    const page = this.page = Doc.idDescendants(main)
    this.main = main
    if (!this.main.parentElement) return // Not gonna happen, but TypeScript cares.
    this.maxBuyLastReqID = 0
    this.maxSellLastReqID = 0
    this.recentlyActiveUserOrders = {}
    this.recentMatches = []
    this.hovers = []
    // 'Recent Matches' list sort key and direction.
    this.recentMatchesSortKey = 'age'
    this.recentMatchesSortDirection = -1
    // store original title so we can re-append it when updating market value.
    this.ogTitle = document.title
    this.runningErrAnimations = []
    this.forms = new Forms(page.forms)
    const candleReporters: CandleReporters = {
      mouse: c => { this.reportMouseCandle(c) }
    }
    this.candleChart = new CandleChart(page.candlesChart, candleReporters)
    this.loadingAnimations = {}

    this.approveTokenForm = new TokenApprovalForm(page.approveTokenForm)

    // Setup the register to trade button.
    // TODO: Use dexsettings page?
    const registerBttn = Doc.tmplElement(page.notRegistered, 'registerBttn')
    bind(registerBttn, 'click', () => {
      app().loadPage('register', { host: this.market.dex.host })
    })

    this.reputationMeter = new ReputationMeter(page.reputationMeter)

    // Bind toggle wallet status form.
    bindForm(page.toggleWalletStatusConfirm, page.toggleWalletStatusSubmit, async () => { this.toggleWalletStatus() })

    // Prepare templates for the buy and sell tables and the user's order table.
    setOptionTemplates(page)

    Doc.cleanTemplates(
      page.orderRowTmpl, page.candleDurBttnTemplate, page.userOrderTmpl, page.recentMatchesTemplate,
      page.completedOrderDurBttnTemplate
    )

    // Buttons to show token approval form
    bind(page.approveBaseBttn, 'click', () => { this.showTokenApprovalForm(true) })
    bind(page.approveQuoteBttn, 'click', () => { this.showTokenApprovalForm(false) })

    const toggleTradingTier = (show: boolean) => {
      Doc.setVis(!show, page.showTradingTier)
      Doc.setVis(show, page.tradingLimits, page.hideTradingTier)
    }
    bind(page.showTradingTier, 'click', () => { toggleTradingTier(true) })
    bind(page.hideTradingTier, 'click', () => { toggleTradingTier(false) })

    const toggleTradingReputation = (show: boolean) => {
      Doc.setVis(!show, page.showTradingReputation)
      Doc.setVis(show, page.reputationMeter, page.hideTradingReputation)
    }
    bind(page.showTradingReputation, 'click', () => { toggleTradingReputation(true) })
    bind(page.hideTradingReputation, 'click', () => { toggleTradingReputation(false) })

    bind(page.qtySliderBuyInput, 'input', () => {
      const page = this.page
      const mkt = this.market

      const sliderValue = this.parseNumber(page.qtySliderBuyInput.value)
      if (sliderValue === null || isNaN(sliderValue) || sliderValue < 0) {
        return
      }

      let maxBuyLots = 0
      const maxBuy = mkt.maxBuys[this.chosenRateBuyAtom]
      if (maxBuy) {
        maxBuyLots = maxBuy.swap.lots
      }
      // Update lot/qty values accordingly, derive lot value (integer) from the value
      // of slider and our wallet balance.
      // Note, slider value of 0 represents 1 lot (while slider value of 1 represents
      // max lots we can buy).
      // No need to check for errors because only user can "produce" an invalid input.
      const lots = Math.max(1, Math.floor(maxBuyLots * sliderValue))
      const adjQtyAtom = this.lotToQtyAtom(lots)
      // Lots and quantity fields are tightly coupled to each other, when one is
      // changed, we need to update the other one as well.
      page.qtyFieldBuy.value = Doc.formatCoinAtomToLotSizeBaseCurrency(
        adjQtyAtom,
        mkt.baseUnitInfo,
        mkt.cfg.lotsize
      )
      this.chosenQtyBuyAtom = adjQtyAtom

      this.renderBuyForm()
    })
    bind(page.qtySliderSellInput, 'input', () => {
      const page = this.page
      const mkt = this.market

      const sliderValue = this.parseNumber(page.qtySliderSellInput.value)
      if (sliderValue === null || isNaN(sliderValue) || sliderValue < 0) {
        return
      }

      let maxSellLots = 0
      if (mkt.maxSell) {
        maxSellLots = mkt.maxSell.swap.lots
      }
      // Update lot/qty values accordingly, derive lot value (integer) from the value
      // of slider and our wallet balance.
      // Note, slider value of 0 represents 1 lot (while slider value of 1 represents
      // max lots we can sell).
      // No need to check for errors because only user can "produce" an invalid input.
      const lots = Math.max(1, Math.floor(maxSellLots * sliderValue))
      const adjQtyAtom = this.lotToQtyAtom(lots)
      // Lots and quantity fields are tightly coupled to each other, when one is
      // changed, we need to update the other one as well.
      page.qtyFieldSell.value = Doc.formatCoinAtomToLotSizeBaseCurrency(
        adjQtyAtom,
        mkt.baseUnitInfo,
        mkt.cfg.lotsize
      )
      this.chosenQtySellAtom = adjQtyAtom

      this.renderSellForm()
    })

    // Handle the full orderbook sent on the 'book' route.
    ws.registerRoute(bookRoute, (data: BookUpdate) => { this.handleBookRoute(data) })
    // Handle the new order for the order book on the 'book_order' route.
    ws.registerRoute(bookOrderRoute, (data: BookUpdate) => { this.handleBookOrderRoute(data) })
    // Remove the order sent on the 'unbook_order' route from the orderbook.
    ws.registerRoute(unbookOrderRoute, (data: BookUpdate) => { this.handleUnbookOrderRoute(data) })
    // Update the remaining quantity on a booked order.
    ws.registerRoute(updateRemainingRoute, (data: BookUpdate) => { this.handleUpdateRemainingRoute(data) })
    // Handle the new order for the order book on the 'epoch_order' route.
    ws.registerRoute(epochOrderRoute, (data: BookUpdate) => { this.handleEpochOrderRoute(data) })
    // Handle the initial candlestick data on the 'candles' route.
    ws.registerRoute(candlesRoute, (data: BookUpdate) => { this.handleCandlesRoute(data) })
    // Handle the candles update on the 'candles' route.
    ws.registerRoute(candleUpdateRoute, (data: BookUpdate) => { this.handleCandleUpdateRoute(data) })

    // Handle the recent matches update on the 'epoch_report' route.
    ws.registerRoute(epochMatchSummaryRoute, (data: BookUpdate) => { this.handleEpochMatchSummary(data) })
    // Create a wallet
    this.newWalletForm = new NewWalletForm(page.newWalletForm, async () => { this.createWallet() })
    // Main order forms.
    bindForm(page.orderFormBuy, page.submitBttnBuy, async () => { this.stepSubmitBuy() })
    bindForm(page.orderFormSell, page.submitBttnSell, async () => { this.stepSubmitSell() })
    // Order verification form.
    bindForm(page.verifyForm, page.vSubmit, async () => { this.submitVerifiedOrder() })

    const closePopups = () => {
      this.forms.close()
    }
    this.keyup = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePopups()
      }
    }
    bind(document, 'keyup', this.keyup)
    page.forms.querySelectorAll('.form-closer').forEach(el => {
      bind(el, 'click', () => { closePopups() })
    })

    // =================================================================
    // Limit order buy: event listeners for handling user interactions.
    // =================================================================
    bind(page.priceBoxBuy, ['click', 'focusin'], () => {
      page.priceBoxBuy.classList.add('selected')
      page.rateFieldBuy.focus()
    })
    bind(page.rateFieldBuy, 'focusout', () => {
      // we are done with this field, no need to keep it selected
      page.priceBoxBuy.classList.remove('selected')
    })
    bind(page.rateFieldBuy, 'input', () => { this.rateFieldBuyInputHandler() })
    bind(page.rateFieldBuy, 'change', () => { this.rateFieldBuyChangeHandler() })
    bind(page.rateFieldBuy, 'keydown', (event: KeyboardEvent) => {
      // using keydown instead of keyup since with keyup there is an issue with event propagating
      // further (moving cursor around from end to start position) even with preventDefault call,
      // with keydown all is working fine
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        this.rateFieldBuyUpHandler()
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        this.rateFieldBuyDownHandler()
      }
      // for every other button let the input come through (don't call event.preventDefault())
    })
    bind(page.rateFieldBuyArrowUp, 'click', () => { this.rateFieldBuyUpHandler() })
    bind(page.rateFieldBuyArrowDown, 'click', () => { this.rateFieldBuyDownHandler() })
    bind(page.qtyBoxBuy, ['click', 'focusin'], () => {
      page.qtyBoxBuy.classList.add('selected')
      page.qtyFieldBuy.focus()
    })
    bind(page.qtyFieldBuy, 'focusout', () => {
      // we are done with this field, no need to keep it selected
      page.qtyBoxBuy.classList.remove('selected')
    })
    bind(page.qtyFieldBuy, 'input', () => { this.qtyFieldBuyInputHandler() })
    bind(page.qtyFieldBuy, 'change', () => { this.qtyFieldBuyChangeHandler() })
    bind(page.qtyFieldBuy, 'keydown', (event: KeyboardEvent) => {
      // using keydown instead of keyup since with keyup there is an issue with event propagating
      // further (moving cursor around from end to start position) even with preventDefault call,
      // with keydown all is working fine
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        this.qtyFieldBuyUpHandler()
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        this.qtyFieldBuyDownHandler()
      }
      // for every other button let the input come through (don't call event.preventDefault())
    })
    bind(page.qtyFieldBuyArrowUp, 'click', () => { this.qtyFieldBuyUpHandler() })
    bind(page.qtyFieldBuyArrowDown, 'click', () => { this.qtyFieldBuyDownHandler() })

    // =================================================================
    // Limit order sell: event listeners for handling user interactions.
    // =================================================================
    bind(page.priceBoxSell, ['click', 'focusin'], () => {
      page.priceBoxSell.classList.add('selected')
      page.rateFieldSell.focus()
    })
    bind(page.rateFieldSell, 'focusout', () => {
      // we are done with this field, no need to keep it selected
      page.priceBoxSell.classList.remove('selected')
    })
    bind(page.rateFieldSell, 'input', () => { this.rateFieldSellInputHandler() })
    bind(page.rateFieldSell, 'change', () => { this.rateFieldSellChangeHandler() })
    bind(page.rateFieldSell, 'keydown', (event: KeyboardEvent) => {
      // using keydown instead of keyup since with keyup there is an issue with event propagating
      // further (moving cursor around from end to start position) even with preventDefault call,
      // with keydown all is working fine
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        this.rateFieldSellUpHandler()
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        this.rateFieldSellDownHandler()
      }
      // for every other button let the input come through (don't call event.preventDefault())
    })
    bind(page.rateFieldSellArrowUp, 'click', () => { this.rateFieldSellUpHandler() })
    bind(page.rateFieldSellArrowDown, 'click', () => { this.rateFieldSellDownHandler() })
    bind(page.qtyBoxSell, ['click', 'focusin'], () => {
      page.qtyBoxSell.classList.add('selected')
      page.qtyFieldSell.focus()
    })
    bind(page.qtyFieldSell, 'focusout', () => {
      // we are done with this field, no need to keep it selected
      page.qtyBoxSell.classList.remove('selected')
    })
    bind(page.qtyFieldSell, 'input', () => { this.qtyFieldSellInputHandler() })
    bind(page.qtyFieldSell, 'change', () => { this.qtyFieldSellChangeHandler() })
    bind(page.qtyFieldSell, 'keydown', (event: KeyboardEvent) => {
      // using keydown instead of keyup since with keyup there is an issue with event propagating
      // further (moving cursor around from end to start position) even with preventDefault call,
      // with keydown all is working fine
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        this.qtyFieldSellUpHandler()
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        this.qtyFieldSellDownHandler()
      }
      // for every other button let the input come through (don't call event.preventDefault())
    })
    bind(page.qtyFieldSellArrowUp, 'click', () => { this.qtyFieldSellUpHandler() })
    bind(page.qtyFieldSellArrowDown, 'click', () => { this.qtyFieldSellDownHandler() })

    // Market search input bindings.
    bind(page.marketSearchV1, ['change', 'keyup'], () => { this.filterMarkets() })

    // Acknowledge the order disclaimer.
    const setDisclaimerAckViz = (acked: boolean) => {
      Doc.setVis(!acked, page.disclaimer, page.disclaimerAck)
      Doc.setVis(acked, page.showDisclaimer)
    }
    bind(page.disclaimerAck, 'click', () => {
      State.storeLocal(State.orderDisclaimerAckedLK, true)
      setDisclaimerAckViz(true)
    })
    bind(page.showDisclaimer, 'click', () => {
      State.storeLocal(State.orderDisclaimerAckedLK, false)
      setDisclaimerAckViz(false)
    })
    setDisclaimerAckViz(State.fetchLocal(State.orderDisclaimerAckedLK))

    // since marketStats resides directly on the header (not markets page) we need to fetch
    // it through markets page parent
    const marketStatsElem = Doc.idDescendants(this.main.parentElement).marketStats
    this.stats = { htmlElem: marketStatsElem, tmpl: Doc.parseTemplate(marketStatsElem) }

    const closeMarketsList = () => {
      Doc.hide(page.leftMarketDock)
      State.storeLocal(State.leftMarketDockLK, '0')
      Doc.show(page.orderBook)
    }
    const openMarketsList = () => {
      Doc.hide(page.orderBook)
      State.storeLocal(State.leftMarketDockLK, '1')
      Doc.show(page.leftMarketDock)
      page.marketSearchV1.focus()
    }
    bind(this.stats.tmpl.marketSelect, 'click', () => {
      if (page.leftMarketDock.clientWidth === 0) openMarketsList()
      else closeMarketsList()
    })
    const initMarket = async (mkt: ExchangeMarket) => {
      // nothing to do if this market is already set/chosen
      const { quoteid: quoteID, baseid: baseID, xc: { host } } = mkt
      if (this.market?.base?.id === baseID && this.market?.quote?.id === quoteID) return
      await this.switchToMarket(host, baseID, quoteID, 0)
    }
    // Prepare the list of markets.
    this.marketList = new MarketList(page.marketListV1)
    for (const row of this.marketList.markets) {
      bind(row.node, 'click', () => {
        initMarket(row.mkt)
      })
      bind(row.node, 'dblclick', () => {
        initMarket(row.mkt)
        closeMarketsList()
      })
    }
    if (State.fetchLocal(State.leftMarketDockLK) !== '1') { // It is shown by default, hiding if necessary.
      closeMarketsList()
    }

    // Notification filters.
    app().registerNoteFeeder({
      order: (note: OrderNote) => { this.handleOrderNote(note) },
      match: (note: MatchNote) => { this.handleMatchNote(note) },
      epoch: (note: EpochNote) => { this.handleEpochNote(note) },
      conn: (note: ConnEventNote) => { this.handleConnNote(note) },
      balance: (note: BalanceNote) => { this.handleBalanceNote(note) },
      bondpost: (note: BondNote) => { this.handleBondUpdate(note) },
      spots: (note: SpotPriceNote) => { this.handlePriceUpdate(note) },
      walletstate: (note: WalletStateNote) => { this.handleWalletState(note) },
      reputation: () => { this.updateReputation() },
      feepayment: () => { this.updateReputation() },
      runstats: () => {
        // nothing to do, we don't support displaying MM form at the moment
      },
      epochreport: () => {
        // nothing to do, we don't support displaying MM form at the moment
      },
      cexproblems: () => {
        // nothing to do, we don't support displaying MM form at the moment
      },
      runevent: () => {
        // nothing to do, we don't support displaying MM form at the moment
      }
    })

    // Start a ticker to update time-since values.
    this.secondTicker = window.setInterval(() => {
      for (const mord of Object.values(this.recentlyActiveUserOrders)) {
        mord.details.age.textContent = Doc.ageSinceFromMs(mord.ord.submitTime)
      }
      for (const td of Doc.applySelector(page.recentMatchesLiveList, '[data-tmpl=age]')) {
        td.textContent = Doc.ageSinceFromMs(parseFloat(td.dataset.timestampMs ?? '0'), true)
      }
    }, 1000)

    this.initMatchesSection()

    // Fetch the first market in the list, or the users last selected market, if
    // it exists.
    let selected
    if (pageParams?.host) {
      selected = makeMarket(pageParams.host, parseInt(pageParams.baseID), parseInt(pageParams.quoteID))
    } else {
      selected = State.fetchLocal(State.lastMarketLK)
    }
    if (!selected || !this.marketList.exists(selected.host, selected.base, selected.quote)) {
      const first = this.marketList.first()
      if (first) {
        selected = { host: first.mkt.xc.host, base: first.mkt.baseid, quote: first.mkt.quoteid }
      }
    }
    if (selected) {
      this.switchToMarket(selected.host, selected.base, selected.quote, 0)
    }

    this.setRegistrationStatusVisibility() // set the initial state for the registration status
  }

  initMatchesSection () {
    const page = this.page

    // Bind active orders list's header sort events.
    page.recentMatchesTable.querySelectorAll('[data-ordercol]').forEach((th: HTMLElement) => bind(
      th, 'click', () => setRecentMatchesSortCol(th.dataset.ordercol || '')
    ))
    const setRecentMatchesSortCol = (key: string) => {
      // First unset header's current sorted col classes.
      unsetRecentMatchesSortColClasses()
      if (this.recentMatchesSortKey === key) {
        this.recentMatchesSortDirection *= -1
      } else {
        this.recentMatchesSortKey = key
        this.recentMatchesSortDirection = 1
      }
      this.refreshRecentMatchesTable()
      setRecentMatchesSortColClasses()
    }
    // sortClassByDirection receives a sort direction and return a class based on it.
    const sortClassByDirection = (element: 1 | -1) => {
      if (element === 1) return 'sorted-asc'
      return 'sorted-dsc'
    }
    const unsetRecentMatchesSortColClasses = () => {
      page.recentMatchesTable.querySelectorAll('[data-ordercol]').forEach(th => th.classList.remove('sorted-asc', 'sorted-dsc'))
    }
    const setRecentMatchesSortColClasses = () => {
      const key = this.recentMatchesSortKey
      const sortCls = sortClassByDirection(this.recentMatchesSortDirection)
      Doc.safeSelector(page.recentMatchesTable, `[data-ordercol=${key}]`).classList.add(sortCls)
    }
    // Set default's sorted col header classes.
    setRecentMatchesSortColClasses()
  }

  // showCandlesLoadingAnimation hides candle chart and displays loading animation, must
  // be done before 'loadcandles' request is issued to properly handle its response
  showCandlesLoadingAnimation () {
    if (this.loadingAnimations.candles) {
      return
    }
    this.candleChart.canvas.classList.add('invisible')
    this.candleChart.pause() // let candle chart know we are in the process of updating it
    this.loadingAnimations.candles = new Wave(this.page.candlesChart, { message: intl.prep(intl.ID_CANDLES_LOADING) })
  }

  /* hasPendingBonds is true if there are pending bonds */
  hasPendingBonds (): boolean {
    return Object.keys(this.market.dex.auth.pendingBonds || []).length > 0
  }

  /* setCurrMarketPrice updates the current market price on the stats displays
     and the orderbook display. */
  setCurrMarketPrice (): void {
    const selectedMkt = this.market

    const setDummyValues = () => {
      this.stats.tmpl.change24.classList.remove('buycolor', 'sellcolor')
      this.stats.tmpl.change24.textContent = '-'
      this.stats.tmpl.volume24.textContent = '-'
      this.stats.tmpl.volume24Unit.textContent = 'USD'
      this.stats.tmpl.bisonPrice.classList.remove('sellcolor', 'buycolor')
      this.stats.tmpl.bisonPrice.textContent = '-'
      let externalPriceFormatted = '-'
      if (mkt) {
        const baseFiatRate = app().fiatRatesMap[selectedMkt.base.id]
        const quoteFiatRate = app().fiatRatesMap[selectedMkt.quote.id]
        externalPriceFormatted = '?'
        if (baseFiatRate && quoteFiatRate) {
          const externalPrice = baseFiatRate / quoteFiatRate
          externalPriceFormatted = Doc.formatRateToRateStep(
            externalPrice,
            selectedMkt.baseUnitInfo,
            selectedMkt.quoteUnitInfo,
            selectedMkt.cfg.ratestep
          )
        }
      }
      this.stats.tmpl.externalPrice.textContent = externalPriceFormatted

      // updates order-book affiliated values
      this.page.obExternalPrice.textContent = `~${externalPriceFormatted}`
    }

    if (!selectedMkt) {
      // not enough info to display current market price
      setDummyValues()
      return
    }
    // Get an up-to-date Market.
    const xc = app().exchanges[selectedMkt.dex.host]
    const mkt = xc.markets[selectedMkt.cfg.name]
    if (!mkt.spot) {
      // not enough info to display current market price
      setDummyValues()
      return
    }

    const recentMatches = this.recentMatchesSorted('age', -1) // freshest first
    if (recentMatches.length === 0) {
      // not enough info to display current market price
      setDummyValues()
      return
    }

    const mostRecentMatchIsBuy = !recentMatches[0].sell

    this.stats.tmpl.bisonPrice.classList.remove('sellcolor', 'buycolor')
    this.stats.tmpl.bisonPrice.classList.add(mostRecentMatchIsBuy ? 'buycolor' : 'sellcolor')
    this.stats.tmpl.bisonPrice.textContent = Doc.formatRateAtomToRateStep(
      mkt.spot.rate,
      selectedMkt.baseUnitInfo,
      selectedMkt.quoteUnitInfo,
      selectedMkt.cfg.ratestep,
      !mostRecentMatchIsBuy
    )

    const baseFiatRate = app().fiatRatesMap[selectedMkt.base.id]
    const quoteFiatRate = app().fiatRatesMap[selectedMkt.quote.id]
    let externalPriceFormatted = '?'
    if (baseFiatRate && quoteFiatRate) {
      const externalPrice = baseFiatRate / quoteFiatRate
      externalPriceFormatted = Doc.formatRateToRateStep(
        externalPrice,
        selectedMkt.baseUnitInfo,
        selectedMkt.quoteUnitInfo,
        selectedMkt.cfg.ratestep
      )
    }
    this.stats.tmpl.externalPrice.textContent = externalPriceFormatted

    const sign = mkt.spot.change24 > 0 ? '+' : ''
    this.stats.tmpl.change24.classList.remove('buycolor', 'sellcolor')
    this.stats.tmpl.change24.classList.add(mkt.spot.change24 >= 0 ? 'buycolor' : 'sellcolor')
    this.stats.tmpl.change24.textContent = `${sign}${(mkt.spot.change24 * 100).toFixed(1)}%`

    const { unitInfo: { conventional: { conversionFactor: cFactor, unit } } } = xc.assets[mkt.baseid]
    if (baseFiatRate) {
      this.stats.tmpl.volume24.textContent = Doc.formatBestWeCan(mkt.spot.vol24 / cFactor * baseFiatRate)
      this.stats.tmpl.volume24Unit.textContent = 'USD'
    } else {
      this.stats.tmpl.volume24.textContent = Doc.formatBestWeCan(mkt.spot.vol24 / cFactor)
      this.stats.tmpl.volume24Unit.textContent = unit
    }

    // updates order-book affiliated values
    this.page.obExternalPrice.textContent = `~${externalPriceFormatted}`
  }

  /* setMarketDetails updates the currency names on the stats displays. */
  setMarketDetails () {
    if (!this.market) return
    const { baseCfg: ba, quoteCfg: qa } = this.market
    this.stats.tmpl.baseIcon.src = Doc.logoPath(ba.symbol)
    this.stats.tmpl.quoteIcon.src = Doc.logoPath(qa.symbol)
    Doc.empty(this.stats.tmpl.baseSymbol, this.stats.tmpl.quoteSymbol)
    this.stats.tmpl.baseSymbol.appendChild(Doc.symbolize(ba, true))
    this.stats.tmpl.quoteSymbol.appendChild(Doc.symbolize(qa, true))
  }

  /**
   * calcMaxOrderLots returns the maximum order size, in lots (buy or sell,
   * depending on what user chose in UI).
   * returns 0 in case it cannot estimate it.
   */
  async calcMaxOrderLots (sell: boolean): Promise<number> {
    if (sell) {
      const res = await this.requestMaxSellEstimateCached()
      if (!res) {
        return 0
      }
      return res.swap.lots
    }

    const res = await this.requestMaxBuyEstimateCached(this.chosenRateBuyAtom)
    if (!res) {
      return 0
    }
    return res.swap.lots
  }

  /**
   * calcMaxOrderQtyAtoms returns the maximum order size, in atoms.
   * returns 0 in case it cannot estimate it.
   */
  async calcMaxOrderQtyAtoms (sell: boolean): Promise<number> {
    const lotSizeAtom = this.market.cfg.lotsize
    const maxOrderLots = await this.calcMaxOrderLots(sell)
    return maxOrderLots * lotSizeAtom
  }

  /* setHighLow calculates the high and low rates over the last 24 hours. */
  setHighLow () {
    let [high, low] = [0, 0]
    const mkt = this.market
    const spot = mkt.cfg.spot
    // Use spot values for 24 hours high and low rates if it is available. We
    // will default to setting it from candles if it's not.
    if (spot && spot.low24 && spot.high24) {
      high = spot.high24
      low = spot.low24
    } else {
      // see if we can calculate high & low based on 5m candles (but only if we have these cached)
      const cache = this.market?.candleCaches[candleBinKey5m]
      if (!cache) {
        this.stats.tmpl.high.textContent = '-'
        this.stats.tmpl.low.textContent = '-'
        return
      }
      const aDayAgo = new Date().getTime() - 86400000
      for (let i = cache.candles.length - 1; i >= 0; i--) {
        const c = cache.candles[i]
        if (c.endStamp < aDayAgo) break
        if (low === 0 || (c.lowRate > 0 && c.lowRate < low)) low = c.lowRate
        if (c.highRate > high) high = c.highRate
      }
    }

    let lowFormatted = '-'
    if (low > 0) {
      lowFormatted = Doc.formatRateAtomToRateStep(
        low,
        mkt.baseUnitInfo,
        mkt.quoteUnitInfo,
        mkt.cfg.ratestep
      )
    }
    this.stats.tmpl.low.textContent = lowFormatted
    let highFormatted = '-'
    if (high > 0) {
      highFormatted = Doc.formatRateAtomToRateStep(
        high,
        mkt.baseUnitInfo,
        mkt.quoteUnitInfo,
        mkt.cfg.ratestep
      )
    }
    this.stats.tmpl.high.textContent = highFormatted
  }

  /* assetsAreSupported is true if all the assets of the current market are
   * supported
   */
  assetsAreSupported (): {
    isSupported: boolean;
    text: string;
    } {
    const { market: { base, quote, baseCfg, quoteCfg } } = this
    if (!base || !quote) {
      const symbol = base ? quoteCfg.symbol : baseCfg.symbol
      return {
        isSupported: false,
        text: intl.prep(intl.ID_NOT_SUPPORTED, { asset: symbol.toUpperCase() })
      }
    }
    // check if versions are supported. If asset is a token, we check if its
    // parent supports the version.
    const bVers = (base.token ? app().assets[base.token.parentID].info?.versions : base.info?.versions) as number[]
    const qVers = (quote.token ? app().assets[quote.token.parentID].info?.versions : quote.info?.versions) as number[]
    // if none them are token, just check if own asset is supported.
    let text = ''
    if (!bVers.includes(baseCfg.version)) {
      text = intl.prep(intl.ID_VERSION_NOT_SUPPORTED, { asset: base.symbol.toUpperCase(), version: baseCfg.version + '' })
    } else if (!qVers.includes(quoteCfg.version)) {
      text = intl.prep(intl.ID_VERSION_NOT_SUPPORTED, { asset: quote.symbol.toUpperCase(), version: quoteCfg.version + '' })
    }
    return {
      isSupported: bVers.includes(baseCfg.version) && qVers.includes(quoteCfg.version),
      text
    }
  }

  /* resolveOrderVsMMForm displays either order form or MM form based on
   * a set of conditions to be met.
   */
  resolveOrderVsMMForm (forceReset?: boolean): void {
    const page = this.page
    const mkt = this.market
    const { base, quote } = mkt

    // sanity-check we are on correct market
    if (!base || !quote) return // market isn't initialized correctly
    if (!this.assetsAreSupported().isSupported) return // assets not supported
    if (!mkt || mkt.dex.auth.effectiveTier < 1) return // acct suspended or not registered
    // check we have required wallets set up, and wallet state (enabled/disabled, locked/unlocked)
    // allows for trading
    const [baseWallet, quoteWallet] = [app().assets[base.id].wallet, app().assets[quote.id].wallet]
    if (!baseWallet || !quoteWallet) return
    if (baseWallet.disabled || quoteWallet.disabled) return
    if (!baseWallet.running || !quoteWallet.running) return
    // check if we have the needed token-approvals
    const { baseAssetApprovalStatus, quoteAssetApprovalStatus } = this.tokenAssetApprovalStatuses()
    if (baseAssetApprovalStatus !== ApprovalStatus.Approved ||
        quoteAssetApprovalStatus !== ApprovalStatus.Approved) {
      return
    }

    // see if we can show order form(s) then

    // if order form is already showing we don't want to re-initialize it because
    // it might contain user inputs already (hence return right away), unless
    // we have been asked to forcefully reset it (which is needed for example when
    // user switches to another market - because we are sharing same order form
    // between different markets)
    if ((Doc.isDisplayed(page.orderFormBuy) || Doc.isDisplayed(page.orderFormSell)) && !forceReset) {
      return
    }

    // show & re-initialize limit order forms, buy/sell buttons are disabled by default unless
    // we explicitly enabled them (having checked that trades can be placed)
    this.chosenRateBuyAtom = 0
    page.rateFieldBuy.value = ''
    this.chosenQtyBuyAtom = 0
    page.qtyFieldBuy.value = ''
    page.qtySliderBuyInput.value = '0'
    page.orderTotalPreviewBuyLeft.textContent = ''
    page.orderTotalPreviewBuyRight.textContent = ''
    this.chosenRateSellAtom = 0
    page.rateFieldSell.value = ''
    this.chosenQtySellAtom = 0
    page.qtyFieldSell.value = ''
    page.qtySliderSellInput.value = '0'
    page.orderTotalPreviewSellLeft.textContent = ''
    page.orderTotalPreviewSellRight.textContent = ''
    this.setOrderBttnBuyEnabled(false)
    this.setOrderBttnSellEnabled(false)
    this.reInitOrderForms(0)
    Doc.show(page.orderFormBuy, page.orderFormSell)

    // show also our reputation on this market
    const { auth: { effectiveTier, pendingStrength } } = mkt.dex
    Doc.setVis(effectiveTier > 0 || pendingStrength > 0, page.reputationAndTradingTierBox)
  }

  reInitOrderForms (retryNum: number) {
    const page = this.page
    const mkt = this.market

    const retryDelay = 250 // 250ms delay
    const maxRetries = 60 // 60 equals to 15s of total retries (with 250ms delay)

    if (!mkt.bookLoaded && retryNum < maxRetries) {
      // we don't have order-book to fetch default buy/sell rates yet, try again later
      setTimeout(() => {
        this.reInitOrderForms(retryNum + 1)
      }, retryDelay)
      return
    }

    if (!this.walletsAreReadyToTrade()) {
      return
    }

    // reinitialize buy limit-order form
    this.setBuyQtyDefault()
    const defaultBuyRateAtom = this.book?.bestBuyRateAtom() || 0
    if (defaultBuyRateAtom !== 0) {
      this.chosenRateBuyAtom = Doc.adjRateAtomsBuy(defaultBuyRateAtom, mkt.cfg.ratestep)
      page.rateFieldBuy.value = Doc.formatRateAtomToRateStep(
        this.chosenRateBuyAtom,
        mkt.baseUnitInfo,
        mkt.quoteUnitInfo,
        mkt.cfg.ratestep,
        false
      )
      // we'll eventually need to fetch max estimate for slider to work, plus to
      // do validation on user inputs, might as well do it now
      this.renderBuyForm()
    } else {
      this.previewTotalBuy(this.chosenRateBuyAtom, this.chosenQtyBuyAtom)
      this.setOrderBttnBuyEnabled(false, 'choose your price')
    }

    // reinitialize sell limit-order form
    this.setSellQtyDefault()
    const defaultSellRateAtom = this.book?.bestSellRateAtom() || 0
    if (defaultSellRateAtom !== 0) {
      this.chosenRateSellAtom = Doc.adjRateAtomsSell(defaultSellRateAtom, mkt.cfg.ratestep)
      page.rateFieldSell.value = Doc.formatRateAtomToRateStep(
        this.chosenRateSellAtom,
        mkt.baseUnitInfo,
        mkt.quoteUnitInfo,
        mkt.cfg.ratestep,
        true
      )
      // we'll eventually need to fetch max estimate for slider to work, plus to
      // do validation on user inputs, might as well do it now
      this.renderSellForm()
    } else {
      this.previewTotalSell(this.chosenRateSellAtom, this.chosenQtySellAtom)
      this.setOrderBttnSellEnabled(false, 'choose your price')
    }
  }

  /* setLoaderMsgVisibility displays a message in case a dex asset is not
   * supported
   */
  setLoaderMsgVisibility () {
    const { page } = this

    const { isSupported, text } = this.assetsAreSupported()
    if (isSupported) {
      // make sure to hide the loader msg
      Doc.hide(page.loaderMsg)
      return
    }
    page.loaderMsg.textContent = text
    Doc.show(page.loaderMsg)
    Doc.hide(page.notRegistered)
    Doc.hide(page.noWallet)
  }

  /*
   * showTokenApprovalForm displays the form used to give allowance to the
   * swap contract of a token.
   */
  async showTokenApprovalForm (isBase: boolean) {
    const assetID = isBase ? this.market.base.id : this.market.quote.id
    await this.approveTokenForm.setAsset(assetID, this.market.dex.host)
    await this.forms.show(this.page.approveTokenForm)
  }

  /*
   * tokenAssetApprovalStatuses returns the approval status of the base and
   * quote assets. If the asset is not a token, it is considered approved.
   */
  tokenAssetApprovalStatuses (): {
    baseAssetApprovalStatus: ApprovalStatus;
    quoteAssetApprovalStatus: ApprovalStatus;
    } {
    const { market: { base, quote } } = this
    let baseAssetApprovalStatus = ApprovalStatus.Approved
    let quoteAssetApprovalStatus = ApprovalStatus.Approved

    if (base?.token) {
      const baseAsset = app().assets[base.id]
      const baseVersion = this.market.dex.assets[base.id].version
      if (baseAsset?.wallet?.approved && baseAsset.wallet.approved[baseVersion] !== undefined) {
        baseAssetApprovalStatus = baseAsset.wallet.approved[baseVersion]
      }
    }
    if (quote?.token) {
      const quoteAsset = app().assets[quote.id]
      const quoteVersion = this.market.dex.assets[quote.id].version
      if (quoteAsset?.wallet?.approved && quoteAsset.wallet.approved[quoteVersion] !== undefined) {
        quoteAssetApprovalStatus = quoteAsset.wallet.approved[quoteVersion]
      }
    }

    return {
      baseAssetApprovalStatus,
      quoteAssetApprovalStatus
    }
  }

  /*
   * setTokenApprovalVisibility sets the visibility of the token approval
   * panel elements.
   */
  setTokenApprovalVisibility () {
    const { page } = this

    const { baseAssetApprovalStatus, quoteAssetApprovalStatus } = this.tokenAssetApprovalStatuses()

    if (baseAssetApprovalStatus === ApprovalStatus.Approved && quoteAssetApprovalStatus === ApprovalStatus.Approved) {
      Doc.hide(page.tokenApproval)
      return
    }

    if (baseAssetApprovalStatus !== ApprovalStatus.Approved && quoteAssetApprovalStatus === ApprovalStatus.Approved) {
      Doc.show(page.approvalRequiredSell)
      Doc.hide(page.approvalRequiredBuy, page.approvalRequiredBoth)
    }

    if (baseAssetApprovalStatus === ApprovalStatus.Approved && quoteAssetApprovalStatus !== ApprovalStatus.Approved) {
      Doc.show(page.approvalRequiredBuy)
      Doc.hide(page.approvalRequiredSell, page.approvalRequiredBoth)
    }

    // If they are both unapproved tokens, the order form will not be shown.
    if (baseAssetApprovalStatus !== ApprovalStatus.Approved && quoteAssetApprovalStatus !== ApprovalStatus.Approved) {
      Doc.show(page.approvalRequiredBoth)
      Doc.hide(page.approvalRequiredSell, page.approvalRequiredBuy)
    }

    Doc.show(page.tokenApproval)
    page.approvalPendingBaseSymbol.textContent = page.baseTokenAsset.textContent = this.market.base.symbol.toUpperCase()
    page.approvalPendingQuoteSymbol.textContent = page.quoteTokenAsset.textContent = this.market.quote.symbol.toUpperCase()
    Doc.setVis(baseAssetApprovalStatus === ApprovalStatus.NotApproved, page.approveBaseBttn)
    Doc.setVis(quoteAssetApprovalStatus === ApprovalStatus.NotApproved, page.approveQuoteBttn)
    Doc.setVis(baseAssetApprovalStatus === ApprovalStatus.Pending, page.approvalPendingBase)
    Doc.setVis(quoteAssetApprovalStatus === ApprovalStatus.Pending, page.approvalPendingQuote)
  }

  /* setRegistrationStatusView sets the text content and class for the
   * registration status view
   */
  setRegistrationStatusView (titleContent: string, confStatusMsg: string, titleClass: string) {
    const page = this.page
    page.regStatusTitle.textContent = titleContent
    page.regStatusConfsDisplay.textContent = confStatusMsg
    page.registrationStatus.classList.remove('completed', 'error', 'waiting')
    page.registrationStatus.classList.add(titleClass)
  }

  /*
   * updateRegistrationStatusView updates the view based on the current
   * registration status
   */
  updateRegistrationStatusView () {
    const { page, market: { dex } } = this
    page.regStatusDex.textContent = dex.host
    page.postingBondsDex.textContent = dex.host

    if (dex.auth.effectiveTier >= 1) {
      this.setRegistrationStatusView(intl.prep(intl.ID_REGISTRATION_FEE_SUCCESS), '', 'completed')
      return
    }

    const confStatuses = (dex.auth.pendingBonds || []).map(pending => {
      const confirmationsRequired = dex.bondAssets[pending.symbol].confs
      return `${pending.confs} / ${confirmationsRequired}`
    })
    const confStatusMsg = confStatuses.join(', ')
    this.setRegistrationStatusView(intl.prep(intl.ID_WAITING_FOR_CONFS), confStatusMsg, 'waiting')
  }

  /*
   * setRegistrationStatusVisibility toggles the registration status view based
   * on the dex data.
   */
  setRegistrationStatusVisibility () {
    const { page, market } = this
    if (!market || !market.dex) return

    // If dex is not connected to server, is not possible to know the
    // registration status.
    if (market.dex.connectionStatus !== ConnectionStatus.Connected) return

    this.updateRegistrationStatusView()

    const showSection = (section: PageElement | undefined) => {
      const elements = [page.registrationStatus, page.bondRequired, page.bondCreationPending, page.notRegistered]
      for (const el of elements) {
        Doc.setVis(el === section, el)
      }
    }

    if (market.dex.auth.effectiveTier >= 1) {
      const toggle = () => {
        showSection(undefined)
        this.resolveOrderVsMMForm()
      }
      if (Doc.isHidden(page.orderFormBuy) || Doc.isHidden(page.orderFormSell)) {
        // wait a couple of seconds before showing the form so the success
        // message is shown to the user
        setTimeout(toggle, 5000)
      }
    } else if (market.dex.viewOnly) {
      page.unregisteredDex.textContent = market.dex.host
      showSection(page.notRegistered)
    } else if (this.hasPendingBonds()) {
      showSection(page.registrationStatus)
    } else if (market.dex.auth.targetTier > 0) {
      showSection(page.bondCreationPending)
    } else {
      page.acctTier.textContent = `${market.dex.auth.effectiveTier}`
      page.dexSettingsLink.href = `/dexsettings/${market.dex.host}`
      showSection(page.bondRequired)
    }
  }

  setOrderBttnText () {
    this.page.submitBttnSell.textContent = intl.prep(intl.ID_SET_BUTTON_SELL, { asset: Doc.shortSymbol(this.market.baseCfg.unitInfo.conventional.unit) })
    this.page.submitBttnBuy.textContent = intl.prep(intl.ID_SET_BUTTON_BUY, { asset: Doc.shortSymbol(this.market.baseCfg.unitInfo.conventional.unit) })
  }

  setOrderBttnBuyEnabled (isEnabled: boolean, disabledTooltipMsg?: string) {
    const btn = this.page.submitBttnBuy
    if (isEnabled) {
      btn.removeAttribute('disabled')
      btn.removeAttribute('title')
    } else {
      btn.setAttribute('disabled', 'true')
      if (disabledTooltipMsg) btn.setAttribute('title', disabledTooltipMsg)
    }
  }

  setOrderBttnSellEnabled (isEnabled: boolean, disabledTooltipMsg?: string) {
    const btn = this.page.submitBttnSell
    if (isEnabled) {
      btn.removeAttribute('disabled')
      btn.removeAttribute('title')
    } else {
      btn.setAttribute('disabled', 'true')
      if (disabledTooltipMsg) btn.setAttribute('title', disabledTooltipMsg)
    }
  }

  setCandleDurationBttns () {
    const { page, market } = this

    Doc.empty(page.candleDurBttnBox)

    for (const dur of market.dex.candleDurs) {
      const bttn = page.candleDurBttnTemplate.cloneNode(true)
      bttn.textContent = dur
      bind(bttn, 'click', () => {
        const dur = bttn.textContent
        if (!dur) {
          return // should never happen since we are initializing button textContent guaranteed
        }
        State.storeLocal(State.lastCandleDurationLK, dur)
        this.selectCandleDurationElem(dur)
        this.loadCandles(dur)
      })
      page.candleDurBttnBox.appendChild(bttn)
    }
  }

  // selectCandleDurationElem draws in UI which candle duration was chosen.
  selectCandleDurationElem (dur: string) {
    for (const bttn of Doc.kids(this.page.candleDurBttnBox)) {
      if (bttn.textContent === dur) {
        bttn.classList.add('selected')
        continue
      }
      bttn.classList.remove('selected')
    }
  }

  setCompletedOrderHistoryDurationBttns () {
    const { page } = this

    Doc.empty(page.completedOrderHistoryDurBttnBox)

    const completedOrderHistoryDurations = [
      completedOrderHistoryDurationHide,
      completedOrderHistoryDuration1d,
      completedOrderHistoryDuration1w,
      completedOrderHistoryDuration1m,
      completedOrderHistoryDuration3m
    ]
    for (const dur of completedOrderHistoryDurations) {
      const bttn = page.completedOrderDurBttnTemplate.cloneNode(true)
      bttn.textContent = dur
      bind(bttn, 'click', () => {
        if (this.actionInflightCompletedOrderHistory) {
          return // let the older request to finish to avoid races
        }

        this.actionInflightCompletedOrderHistory = true

        const dur = bttn.textContent
        if (!dur) {
          return // should never happen since we are initializing button textContent guaranteed
        }
        this.selectCompletedOrderHistoryDurationElem(dur)
        this.reloadCompletedUserOrders(dur).then(() => {
          this.actionInflightCompletedOrderHistory = false
        })
      })
      page.completedOrderHistoryDurBttnBox.appendChild(bttn)
    }
  }

  // selectCompletedOrderHistoryDurationElem draws in UI which completed order history
  // duration was chosen.
  selectCompletedOrderHistoryDurationElem (dur: string) {
    for (const bttn of Doc.kids(this.page.completedOrderHistoryDurBttnBox)) {
      if (bttn.textContent === dur) {
        bttn.classList.add('selected')
        continue
      }
      bttn.classList.remove('selected')
    }
  }

  /* switchToMarket sets the currently displayed market. */
  async switchToMarket (host: string, baseID: number, quoteID: number, retryNum: number) {
    const dex = app().user.exchanges[host]
    const page = this.page

    Doc.hide(page.chartErrMsg)
    // clear orderbook (it contains old data now)
    Doc.empty(this.page.buyRows, this.page.sellRows)
    // hide order form (it contains old data now)
    Doc.hide(page.orderFormBuy, page.orderFormSell)
    // clear recent matches for the previous market. This will be set when we
    // receive the order book subscription response
    this.recentMatches = []
    Doc.empty(page.recentMatchesLiveList)
    // hide other notice-type forms
    Doc.hide(page.notRegistered, page.bondRequired, page.noWallet)
    Doc.show(this.stats.htmlElem)

    // If we have not yet connected, there is no dex.assets or any other
    // exchange data, so just put up a message and wait for the connection to be
    // established, at which time handleConnNote will refresh and reload.
    if (!dex || !dex.markets || dex.connectionStatus !== ConnectionStatus.Connected) {
      let errMsg = intl.prep(intl.ID_CONNECTION_FAILED)
      if (dex.disabled) errMsg = intl.prep(intl.ID_DEX_DISABLED_MSG)
      page.chartErrMsg.textContent = errMsg
      Doc.show(page.chartErrMsg)
      return
    }

    const baseCfg = dex.assets[baseID]
    const quoteCfg = dex.assets[quoteID]
    const [bui, qui] = [app().unitInfo(baseID, dex), app().unitInfo(quoteID, dex)]
    const rateConversionFactor = OrderUtil.RateEncodingFactor / bui.conventional.conversionFactor * qui.conventional.conversionFactor
    const mktId = marketID(baseCfg.symbol, quoteCfg.symbol)
    const baseAsset = app().assets[baseID]
    const quoteAsset = app().assets[quoteID]
    const mkt = {
      dex: dex,
      name: mktId, // A string market identifier used by the DEX.
      cfg: dex.markets[mktId],
      // app().assets is a map of core.SupportedAsset type, which can be found at
      // client/core/types.go.
      base: baseAsset,
      quote: quoteAsset,
      baseUnitInfo: bui,
      quoteUnitInfo: qui,
      maxSell: null,
      maxBuys: {},
      maxSellRequested: false,
      candleCaches: {},
      baseCfg,
      quoteCfg,
      rateConversionFactor,
      sellBalance: 0,
      buyBalance: 0,
      bookLoaded: false
    }
    this.market = mkt

    const retryDelay = 250 // 250ms delay
    const maxRetries = 120 // 120 equals to 30s of total retries (with 250ms delay)

    const [fiatRateAtom] = this.fiatRate()
    if (fiatRateAtom === 0 && retryNum < maxRetries) {
      // we don't have fiat rate just yet, many views on markets page rely on fiat rate to be
      // there to display various - so it's better to wait and try again
      setTimeout(() => {
        this.switchToMarket(host, baseID, quoteID, retryNum + 1)
      }, retryDelay)
      return
    }

    this.displayMessageIfMissingWallet()
    this.setMarketDetails()
    this.setCurrMarketPrice()

    this.setCandleDurationBttns()
    // use user's last known candle duration (or 24h) as "initial default"
    const candleDur = State.fetchLocal(State.lastCandleDurationLK) || candleBinKey24h
    this.selectCandleDurationElem(candleDur)
    this.loadCandles(candleDur)

    State.storeLocal(State.lastMarketLK, {
      host: host,
      base: baseID,
      quote: quoteID
    })
    app().updateMarketElements(this.main, baseID, quoteID, dex)
    this.marketList.select(host, baseID, quoteID)
    this.setLoaderMsgVisibility()
    this.setTokenApprovalVisibility()
    this.setRegistrationStatusVisibility()
    this.resolveOrderVsMMForm(true)
    this.setOrderBttnText()
    this.updateTitle()
    this.reputationMeter.setHost(dex.host)
    this.updateReputation()
    await this.reloadRecentlyActiveUserOrders()

    this.setCompletedOrderHistoryDurationBttns()
    this.selectCompletedOrderHistoryDurationElem(completedOrderHistoryDurationHide)
    await this.reloadCompletedUserOrders(completedOrderHistoryDurationHide)

    // update header for "matches" section
    page.priceHdr.textContent = `Price (${Doc.shortSymbol(this.market.quote.symbol)})`
    page.ageHdr.textContent = 'Age'
    page.qtyHdr.textContent = `Size (${Doc.shortSymbol(this.market.base.symbol)})`
  }

  /*
    displayMessageForMissingWallet displays a custom message on the market's
    view if one or more of the selected market's wallet is missing.
  */
  displayMessageIfMissingWallet () {
    const page = this.page
    const mkt = this.market
    const baseSym = mkt.baseCfg.symbol.toLocaleUpperCase()
    const quoteSym = mkt.quoteCfg.symbol.toLocaleUpperCase()

    Doc.hide(page.noWallet)

    const showNoWallet = (msg: string): void => {
      page.noWallet.textContent = msg
      Doc.show(page.noWallet)
    }

    if (!mkt.base?.wallet && !mkt.quote?.wallet) {
      showNoWallet(intl.prep(intl.ID_NO_WALLET_MSG, { asset1: baseSym, asset2: quoteSym }))
      return
    }
    if (!mkt.base?.wallet) {
      showNoWallet(intl.prep(intl.ID_CREATE_ASSET_WALLET_MSG, { asset: baseSym }))
      return
    }
    if (!mkt.quote?.wallet) {
      showNoWallet(intl.prep(intl.ID_CREATE_ASSET_WALLET_MSG, { asset: quoteSym }))
      return
    }
    if (mkt.base.wallet.disabled || !mkt.base.wallet.running) {
      showNoWallet(intl.prep(intl.ID_ENABLE_ASSET_WALLET_MSG, { asset: baseSym }))
      return
    }
    if (mkt.quote.wallet.disabled || !mkt.quote.wallet.running) {
      showNoWallet(intl.prep(intl.ID_ENABLE_ASSET_WALLET_MSG, { asset: quoteSym }))
    }
  }

  reportMouseCandle (candle: Candle | null) {
    const page = this.page
    const mkt = this.market

    if (!candle) {
      Doc.hide(page.candlesLegend)
      return
    }
    Doc.show(page.candlesLegend)

    page.candleStart.textContent = Doc.formatRateAtomToRateStep(
      candle.startRate,
      mkt.baseUnitInfo,
      mkt.quoteUnitInfo,
      mkt.cfg.ratestep
    )
    page.candleEnd.textContent = Doc.formatRateAtomToRateStep(
      candle.endRate,
      mkt.baseUnitInfo,
      mkt.quoteUnitInfo,
      mkt.cfg.ratestep
    )
    page.candleHigh.textContent = Doc.formatRateAtomToRateStep(
      candle.highRate,
      mkt.baseUnitInfo,
      mkt.quoteUnitInfo,
      mkt.cfg.ratestep
    )
    page.candleLow.textContent = Doc.formatRateAtomToRateStep(
      candle.lowRate,
      mkt.baseUnitInfo,
      mkt.quoteUnitInfo,
      mkt.cfg.ratestep
    )
    page.candleVol.textContent = Doc.formatCoinAtom(candle.matchVolume, mkt.baseUnitInfo)
  }

  /*
   * buildOrderSell builds a TradeForm wire-representation that will be sent to
   * Golang client side. Data is not validated in any way (assumes done previously).
   */
  buildOrderBuy (): TradeForm {
    const market = this.market

    const qtyAtom = this.chosenQtyBuyAtom

    return {
      host: market.dex.host,
      isLimit: true,
      sell: false,
      base: market.base.id,
      quote: market.quote.id,
      qty: qtyAtom,
      rate: this.chosenRateBuyAtom,
      tifnow: false,
      options: {}
    }
  }

  /*
 * buildOrderSell builds a TradeForm wire-representation that will be sent to
 * Golang client side. Data is not validated in any way (assumes done previously).
 */
  buildOrderSell (): TradeForm {
    const market = this.market

    const qtyAtom = this.chosenQtySellAtom

    return {
      host: market.dex.host,
      isLimit: true,
      sell: true,
      base: market.base.id,
      quote: market.quote.id,
      qty: qtyAtom,
      rate: this.chosenRateSellAtom,
      tifnow: false,
      options: {}
    }
  }

  /**
   * previewTotalBuy calculates and displays Total value (in quote asset) for the order.
   * It also updates order button state based on the values in the order form.
   */
  previewTotalBuy (orderRateAtom: number, orderQtyAtom: number) {
    const page = this.page
    const market = this.market

    const maxDigits = 9 // how large a formatted number can be (for total preview)

    if (orderQtyAtom > 0 && orderRateAtom > 0) {
      const totalOut = orderQtyAtom * orderRateAtom / OrderUtil.RateEncodingFactor
      const totalIn = orderQtyAtom

      page.orderTotalPreviewBuyLeft.textContent = intl.prep(
        intl.ID_LIMIT_ORDER_BUY_SELL_OUT_TOTAL_PREVIEW,
        {
          total: Doc.capNumberStr(Doc.formatCoinAtomToLotSizeQuoteCurrency(
            totalOut,
            market.baseUnitInfo,
            market.quoteUnitInfo,
            market.cfg.lotsize,
            market.cfg.ratestep
          ), maxDigits),
          asset: market.quoteUnitInfo.conventional.unit
        }
      )
      page.orderTotalPreviewBuyRight.textContent = intl.prep(
        intl.ID_LIMIT_ORDER_BUY_SELL_IN_TOTAL_PREVIEW,
        {
          total: Doc.capNumberStr(Doc.formatCoinAtomToLotSizeBaseCurrency(
            totalIn,
            market.baseUnitInfo,
            market.cfg.lotsize
          ), maxDigits),
          asset: market.baseUnitInfo.conventional.unit
        }
      )
    } else {
      page.orderTotalPreviewBuyLeft.textContent = ''
      page.orderTotalPreviewBuyRight.textContent = ''
    }
  }

  /**
   * previewTotalSell calculates and displays Total value (in quote asset) for the order.
   * It also updates order button state based on the values in the order form.
   */
  previewTotalSell (orderRateAtom: number, orderQtyAtom: number) {
    const page = this.page
    const market = this.market

    const maxDigits = 9 // how large a formatted number can be (for total preview)

    if (orderQtyAtom > 0 && orderRateAtom > 0) {
      const totalOut = orderQtyAtom * orderRateAtom / OrderUtil.RateEncodingFactor
      const totalIn = orderQtyAtom

      page.orderTotalPreviewSellLeft.textContent = intl.prep(
        intl.ID_LIMIT_ORDER_BUY_SELL_OUT_TOTAL_PREVIEW,
        {
          total: Doc.capNumberStr(Doc.formatCoinAtomToLotSizeBaseCurrency(
            totalIn,
            market.baseUnitInfo,
            market.cfg.lotsize
          ), maxDigits),
          asset: market.baseUnitInfo.conventional.unit
        }
      )
      page.orderTotalPreviewSellRight.textContent = intl.prep(
        intl.ID_LIMIT_ORDER_BUY_SELL_IN_TOTAL_PREVIEW,
        {
          total: Doc.capNumberStr(Doc.formatCoinAtomToLotSizeQuoteCurrency(
            totalOut,
            market.baseUnitInfo,
            market.quoteUnitInfo,
            market.cfg.lotsize,
            market.cfg.ratestep
          ), maxDigits),
          asset: market.quoteUnitInfo.conventional.unit
        }
      )
    } else {
      page.orderTotalPreviewSellLeft.textContent = ''
      page.orderTotalPreviewSellRight.textContent = ''
    }
  }

  // walletsAreReadyToTrade checks if wallets exist, note we could also check if wallets
  // are synced as well but that could be too aggressive (result in false-positives) and
  // we check for it on back-end anyway (so it's not mandatory to do it here).
  walletsAreReadyToTrade (): boolean {
    const mkt = this.market

    const baseAsset = app().assets[mkt.base.id]
    if (!baseAsset) {
      this.setOrderBttnBuyEnabled(false, 'base wallet doesn\'t exist')
    }

    const quoteAsset = app().assets[mkt.quote.id]
    if (!quoteAsset) {
      this.setOrderBttnSellEnabled(false, 'quote wallet doesn\'t exist')
    }

    return baseAsset != null && quoteAsset != null
  }

  /**
   * renderBuyForm performs necessary final steps to display the latest state of buy order form.
   */
  async renderBuyForm () {
    // preview total regardless of whether we can afford it
    this.previewTotalBuy(this.chosenRateBuyAtom, this.chosenQtyBuyAtom)
    await this.previewMaxBuy()
  }

  /**
   * renderSellForm performs necessary final steps to display the latest state of sell order form.
   */
  async renderSellForm () {
    // preview total regardless of whether we can afford it
    this.previewTotalSell(this.chosenRateSellAtom, this.chosenQtySellAtom)
    await this.previewMaxSell()
  }

  /**
   * previewMaxBuy recalculates new max buy estimate (that depends on chosen rate value),
   * as well as validates whether currently chosen quantity (on buy order form) can be
   * purchased - and adjusts buy button accordingly.
   */
  async previewMaxBuy () {
    const mkt = this.market

    const quoteWallet = app().assets[mkt.quote.id].wallet
    const aLotAtom = mkt.cfg.lotsize * (this.chosenRateBuyAtom / OrderUtil.RateEncodingFactor)
    if (quoteWallet.balance.available < aLotAtom) {
      this.setOrderBttnBuyEnabled(false, intl.prep(intl.ID_ORDER_BUTTON_BUY_BALANCE_ERROR))
      return
    }

    this.setOrderBttnBuyEnabled(false, 'calculating how much we can buy ...')

    this.maxBuyLastReqID++
    const reqID = this.maxBuyLastReqID
    const maxBuy = await this.requestMaxBuyEstimateCached(this.chosenRateBuyAtom)
    if (reqID !== this.maxBuyLastReqID) {
      // a fresher action has been issued, no need to apply the effects of this one,
      // the fresher one will also update order button state as needed
      return
    }
    if (!maxBuy || this.chosenQtyBuyAtom > maxBuy.swap.lots * mkt.cfg.lotsize) {
      this.setOrderBttnBuyEnabled(false, intl.prep(intl.ID_ORDER_BUTTON_BUY_BALANCE_ERROR))
      return
    }

    this.setOrderBttnBuyEnabled(true)
  }

  /**
   * previewMaxSell recalculates new max sell estimate (that depends on chosen rate value),
   * as well as validates whether currently chosen quantity (on sell order form) can be
   * purchased - and adjusts sell button accordingly.
   */
  async previewMaxSell () {
    const mkt = this.market

    const baseWallet = app().assets[this.market.base.id].wallet
    if (baseWallet.balance.available < mkt.cfg.lotsize) {
      this.setOrderBttnSellEnabled(false, intl.prep(intl.ID_ORDER_BUTTON_SELL_BALANCE_ERROR))
      return
    }

    this.setOrderBttnSellEnabled(false, 'calculating how much we can sell ...')

    this.maxSellLastReqID++
    const reqID = this.maxSellLastReqID
    const maxSell = await this.requestMaxSellEstimateCached()
    if (reqID !== this.maxSellLastReqID) {
      // a fresher action has been issued, no need to apply the effects of this one,
      // the fresher one will also update order button state as needed
      return
    }
    if (!maxSell || this.chosenQtySellAtom > maxSell.swap.value) {
      this.setOrderBttnSellEnabled(false, intl.prep(intl.ID_ORDER_BUTTON_SELL_BALANCE_ERROR))
      return
    }

    this.setOrderBttnSellEnabled(true)
  }

  async requestMaxBuyEstimateCached (rateAtom: number): Promise<any> {
    const maxBuy = this.market.maxBuys[rateAtom]
    if (maxBuy) {
      return maxBuy
    }

    const marketBefore = this.market.name
    const res = await this.requestMaxEstimate('/api/maxbuy', { rate: rateAtom })
    if (!res) {
      return null
    }
    const marketAfter = this.market.name

    // see if user has switched to another market while we were waiting on reply
    if (marketBefore !== marketAfter) {
      return null
    }

    this.market.maxBuys[rateAtom] = res.maxBuy
    // see buyBalance desc for why we are doing this
    this.market.buyBalance = app().assets[this.market.quote.id].wallet.balance.available

    return res.maxBuy
  }

  async requestMaxSellEstimateCached (): Promise<any> {
    const maxSell = this.market.maxSell
    if (maxSell) {
      return maxSell
    }

    const marketBefore = this.market.name
    const res = await this.requestMaxEstimate('/api/maxsell', {})
    if (!res) {
      return null
    }
    const marketAfter = this.market.name

    // see if user has switched to another market while we were waiting on reply
    if (marketBefore !== marketAfter) {
      return null
    }

    this.market.maxSell = res.maxSell
    // see sellBalance desc for why we are doing this
    this.market.sellBalance = app().assets[this.market.base.id].wallet.balance.available

    return res.maxSell
  }

  /**
   * requestMaxEstimate calls an order estimate api endpoint. If another call to
   * requestMaxEstimate is made before this one is finished, this call will be canceled.
   */
  async requestMaxEstimate (path: string, args: any): Promise<any> {
    const [bid, qid] = [this.market.base.id, this.market.quote.id]
    const [bWallet, qWallet] = [app().assets[bid].wallet, app().assets[qid].wallet]
    if (!bWallet || !bWallet.running || !qWallet || !qWallet.running) return null

    const res = await postJSON(path, {
      host: this.market.dex.host,
      base: bid,
      quote: qid,
      ...args
    })
    if (!app().checkResponse(res)) {
      return null
    }
    return res
  }

  /*
   * validateOrderBuy performs some basic order sanity checks, returning boolean
   * true if the order appears valid.
   */
  async validateOrderBuy (order: TradeForm) {
    const { page, market: { cfg: { minimumRate }, rateConversionFactor } } = this

    const showError = function (err: string) {
      page.orderErrBuy.textContent = err
      Doc.show(page.orderErrBuy)
    }

    if (!order.rate) {
      showError(intl.prep(intl.ID_NO_ZERO_RATE))
      return false
    }
    if (order.rate < minimumRate) {
      const [r, minRate] = [order.rate / rateConversionFactor, minimumRate / rateConversionFactor]
      showError(`rate is lower than the market's minimum rate. ${r} < ${minRate}`)
      return false
    }
    if (!order.qty) {
      // Hints to the user what inputs don't pass validation.
      this.animateErrors(highlightOutlineRed(page.qtyBoxBuy))
      showError(intl.prep(intl.ID_NO_ZERO_QUANTITY))
      return false
    }
    if (order.qty > await this.calcMaxOrderQtyAtoms(order.sell)) {
      // Hints to the user what inputs don't pass validation.
      this.animateErrors(highlightOutlineRed(page.qtyBoxBuy))
      showError(intl.prep(intl.ID_NO_QUANTITY_EXCEEDS_MAX))
      return false
    }
    return true
  }

  /*
 * validateOrderSell performs some basic order sanity checks, returning boolean
 * true if the order appears valid.
 */
  async validateOrderSell (order: TradeForm) {
    const { page, market: { cfg: { minimumRate }, rateConversionFactor } } = this

    const showError = function (err: string) {
      page.orderErrSell.textContent = err
      Doc.show(page.orderErrSell)
    }

    if (!order.rate) {
      showError(intl.prep(intl.ID_NO_ZERO_RATE))
      return false
    }
    if (order.rate < minimumRate) {
      const [r, minRate] = [order.rate / rateConversionFactor, minimumRate / rateConversionFactor]
      showError(`rate is lower than the market's minimum rate. ${r} < ${minRate}`)
      return false
    }
    if (!order.qty) {
      // Hints to the user what inputs don't pass validation.
      this.animateErrors(highlightOutlineRed(page.qtyBoxSell))
      showError(intl.prep(intl.ID_NO_ZERO_QUANTITY))
      return false
    }
    if (order.qty > await this.calcMaxOrderQtyAtoms(order.sell)) {
      // Hints to the user what inputs don't pass validation.
      this.animateErrors(highlightOutlineRed(page.qtyBoxSell))
      showError(intl.prep(intl.ID_NO_QUANTITY_EXCEEDS_MAX))
      return false
    }
    return true
  }

  /*
   * midGapRateConventional is the same as midGap, but returns the mid-gap rate as
   * the conventional ratio. This is used to convert from a conventional
   * quantity from base to quote or vice-versa, or for display purposes.
   */
  midGapRateConventional (): number | null {
    const gapAtom = this.midGapRateAtom()
    if (!gapAtom) return null
    const { baseUnitInfo: b, quoteUnitInfo: q } = this.market
    return (gapAtom / OrderUtil.RateEncodingFactor) * (b.conventional.conversionFactor / q.conventional.conversionFactor)
  }

  /*
   * midGapRateAtom returns the value in the middle of the best buy and best sell. If
   * either one of the buy or sell sides are empty, midGap returns the best rate
   * from the other side. If both sides are empty, midGap returns the value 0.
   * The rate returned is the atomic ratio, used for conversion. For a
   * conventional rate for display or to convert conventional units, use
   * midGapConventional
   */
  midGapRateAtom (): number {
    const book = this.book
    if (!book) return 0
    if (book.buys && book.buys.length) {
      if (book.sells && book.sells.length) {
        return this.adjustRateAtoms((book.buys[0].msgRate + book.sells[0].msgRate) / 2)
      }
      return this.adjustRateAtoms(book.buys[0].msgRate) // should be no-op
    }
    if (book.sells && book.sells.length) {
      return this.adjustRateAtoms(book.sells[0].msgRate) // should be no-op
    }
    return 0
  }

  // reloadRecentlyActiveUserOrders completely redraws recently active user orders section on
  // markets page.
  async reloadRecentlyActiveUserOrders () {
    // erase all previously drawn recently active user orders
    for (const oid in this.recentlyActiveUserOrders) {
      delete this.recentlyActiveUserOrders[oid]
    }

    const { base: b, quote: q, dex: { host }, cfg: { name: mktID } } = this.market
    if (!b || !q) {
      // unsupported asset, show empty list
      return this.drawRecentlyActiveUserOrders([])
    }

    let recentOrders = app().recentOrders(host, mktID)
    if (recentOrders.length !== 0) {
      this.drawRecentlyActiveUserOrders(recentOrders)
      return
    }

    // we've probably just started and haven't received any order notifications yet,
    // fetch orders explicitly then
    const filter: OrderFilter = {
      hosts: [host],
      market: { baseID: b.id, quoteID: q.id },
      n: maxRecentlyActiveUserOrdersShown
    }
    const res = await postJSON('/api/orders', filter)
    if (!res.orders) {
      this.drawRecentlyActiveUserOrders([]) // we have not even 1 order for this market, show empty list
    }
    recentOrders = res.orders.filter((ord: Order): boolean => {
      const orderIsActive = ord.status < OrderUtil.StatusExecuted || OrderUtil.hasActiveMatches(ord)
      if (orderIsActive) {
        return true // currently active order
      }
      const now = new Date().getTime()
      const minute = 60 * 1000
      if (now - ord.stamp <= 10 * minute) {
        return true // inactive but recent order
      }
      return false
    })
    this.drawRecentlyActiveUserOrders(recentOrders)
  }

  /* refreshRecentlyActiveOrders refreshes the user's active order list based on notifications feed */
  refreshRecentlyActiveOrders () {
    const orders = app().recentOrders(this.market.dex.host, marketID(this.market.baseCfg.symbol, this.market.quoteCfg.symbol))
    this.drawRecentlyActiveUserOrders(orders)
  }

  drawRecentlyActiveUserOrders (orders: Order[]) {
    const { page, recentlyActiveUserOrders, market } = this

    // enrich recently active user order list as necessary
    for (const ord of orders) {
      recentlyActiveUserOrders[ord.id] = { ord: ord } as MetaOrder
    }

    // get rid of inactive orders (cancels, revokes, etc.) - showing these would be too spammy
    const orderIsActive = (ord: Order) => ord.status < OrderUtil.StatusExecuted || OrderUtil.hasActiveMatches(ord)
    let sortedOrders = Object.keys(recentlyActiveUserOrders).map((oid: string) => recentlyActiveUserOrders[oid])
    sortedOrders = sortedOrders.filter((mo: MetaOrder): boolean => {
      return orderIsActive(mo.ord)
    })
    sortedOrders.sort((a: MetaOrder, b: MetaOrder) => {
      return b.ord.submitTime - a.ord.submitTime
    })
    // we have to cap how many orders we can show in UI
    if (sortedOrders.length > maxRecentlyActiveUserOrdersShown) {
      sortedOrders = sortedOrders.slice(0, maxRecentlyActiveUserOrdersShown)
    }

    // empty recently active user order list as necessary, we'll re-populate it down below
    // since some orders might not make it in UI (because we cap how many orderw we show)
    for (const oid in recentlyActiveUserOrders) {
      delete recentlyActiveUserOrders[oid]
    }

    Doc.empty(page.recentlyActiveUserOrders)
    Doc.setVis(sortedOrders?.length, page.recentlyActiveUserOrders)
    Doc.setVis(!sortedOrders?.length, page.recentlyActiveNoUserOrders)

    let unreadyOrders = false
    for (const mord of sortedOrders) {
      const div = page.userOrderTmpl.cloneNode(true) as HTMLElement
      page.recentlyActiveUserOrders.appendChild(div)
      const tmpl = Doc.parseTemplate(div)
      const header = Doc.parseTemplate(tmpl.header)
      const details = Doc.parseTemplate(tmpl.details)

      mord.div = div
      mord.header = header
      mord.details = details
      const ord = mord.ord
      const orderID = ord.id
      const isActive = orderIsActive(ord)

      // No need to track in-flight orders here. We've already added it to display.
      if (orderID) {
        recentlyActiveUserOrders[orderID] = mord
      }

      if (!ord.readyToTick && OrderUtil.hasActiveMatches(ord)) {
        tmpl.header.classList.add('unready-user-order')
        unreadyOrders = true
      }
      header.sideLight.classList.add(ord.sell ? 'sell' : 'buy')
      if (!isActive) header.sideLight.classList.add('inactive')
      details.side.textContent = mord.header.side.textContent = OrderUtil.sellString(ord)
      details.side.classList.add(ord.sell ? 'sellcolor' : 'buycolor')
      header.side.classList.add(ord.sell ? 'sellcolor' : 'buycolor')
      const unfilledFormatted = Doc.formatCoinAtomToLotSizeBaseCurrency(
        ord.qty - OrderUtil.filled(ord),
        market.baseUnitInfo,
        market.cfg.lotsize
      )
      mord.header.qty.textContent = `${unfilledFormatted}`
      details.qty.textContent = Doc.formatCoinAtomToLotSizeBaseCurrency(ord.qty, market.baseUnitInfo, market.cfg.lotsize)
      let headerRateStr = Doc.formatRateAtomToRateStep(ord.rate, market.baseUnitInfo, market.quoteUnitInfo, market.cfg.ratestep, ord.sell)
      let detailsRateStr = Doc.formatRateAtomToRateStep(ord.rate, market.baseUnitInfo, market.quoteUnitInfo, market.cfg.ratestep, ord.sell)
      if (ord.type === OrderUtil.Market) {
        headerRateStr = this.marketOrderHeaderRateString(ord, market)
        detailsRateStr = this.marketOrderDetailsRateString(ord, market)
      }
      mord.header.rate.textContent = `@ ${headerRateStr}`
      details.rate.textContent = detailsRateStr
      header.baseSymbol.textContent = market.baseUnitInfo.conventional.unit
      details.type.textContent = OrderUtil.orderTypeText(ord.type)
      this.updateMetaOrder(mord)

      const cancelOrder = async (e: Event) => {
        e.stopPropagation()

        const order = this.recentlyActiveUserOrders[orderID].ord

        const req = {
          orderID: order.id
        }
        const res = await postJSON('/api/cancel', req)
        // Display error on confirmation modal.
        if (!app().checkResponse(res)) {
          console.log("couldn't cancel order, error response:", res.msg)
          return
        }
        order.cancelling = true
      }

      if (!orderID) {
        Doc.hide(details.cancelBttn)
        Doc.hide(details.link)
      } else {
        if (OrderUtil.isCancellable(ord)) {
          Doc.show(details.cancelBttn)
          bind(details.cancelBttn, 'click', (e: Event) => { cancelOrder(e) })
        }

        details.link.href = `order/${orderID}`
        app().bindInternalNavigation(div)
      }
      let currentFloater: (PageElement | null)
      bind(tmpl.header, 'click', () => {
        if (Doc.isDisplayed(tmpl.details)) {
          Doc.hide(tmpl.details)
          return
        }
        Doc.show(tmpl.details)
        if (currentFloater) currentFloater.remove()
      })
      /**
       * We'll show the button menu when they hover over the header. To avoid
       * pushing the layout around, we'll show the buttons as an absolutely
       * positioned copy of the button menu.
       */
      bind(tmpl.header, 'mouseenter', () => {
        // Don't show the copy if the details are already displayed.
        if (Doc.isDisplayed(tmpl.details)) return
        if (currentFloater) currentFloater.remove()
        // Create and position the element based on the position of the header.
        const floater = document.createElement('div')
        currentFloater = floater
        document.body.appendChild(floater)
        floater.className = 'user-order-floaty-menu'
        const m = Doc.layoutMetrics(tmpl.header)
        const y = m.bodyTop + m.height
        floater.style.top = `${y - 1}px` // - 1 to hide border on header div
        floater.style.left = `${m.bodyLeft}px`
        // Get the updated version of the order
        const mord = this.recentlyActiveUserOrders[orderID]
        // if the order isn't among user orders it means we are still showing it in UI, yet it's
        // no longer relevant - do nothing in that case (it will get removed from UI eventually)
        if (!mord) {
          return
        }
        const ord = mord.ord

        const addButton = (baseBttn: PageElement, cb: ((e: Event) => void)) => {
          const icon = baseBttn.cloneNode(true) as PageElement
          floater.appendChild(icon)
          Doc.show(icon)
          bind(icon, 'click', (e: Event) => { cb(e) })
        }

        if (OrderUtil.isCancellable(ord)) addButton(details.cancelBttn, (e: Event) => { cancelOrder(e) })
        floater.appendChild(details.link.cloneNode(true))

        const ogScrollY = page.orderScroller.scrollTop
        // Set up the hover interactions.
        const moved = (e: MouseEvent) => {
          // If the user scrolled, reposition the float menu. This keeps the
          // menu from following us around, which can prevent removal below.
          const yShift = page.orderScroller.scrollTop - ogScrollY
          floater.style.top = `${y + yShift}px`
          if (Doc.mouseInElement(e, floater) || Doc.mouseInElement(e, div)) return
          floater.remove()
          currentFloater = null
          document.removeEventListener('mousemove', moved)
          page.orderScroller.removeEventListener('scroll', moved)
        }
        document.addEventListener('mousemove', moved)
        page.orderScroller.addEventListener('scroll', moved)
      })
      app().bindTooltips(div)
    }
    Doc.setVis(unreadyOrders, page.unreadyOrdersMsg)
  }

  async reloadCompletedUserOrders (period: string) {
    const { page, market } = this
    const { base: b, quote: q, dex: { host } } = market
    const now = new Date()

    let completedUserOrders = []
    let fresherThanUnixMs = 0 // default, means not showing completed orders history
    if (period === completedOrderHistoryDuration1d) {
      const day = 24 * 60 * 60 * 1000
      fresherThanUnixMs = now.getTime() - day
    }
    if (period === completedOrderHistoryDuration1w) {
      const week = 7 * 24 * 60 * 60 * 1000
      fresherThanUnixMs = now.getTime() - week
    }
    if (period === completedOrderHistoryDuration1m) {
      fresherThanUnixMs = new Date().setMonth(now.getMonth() - 1) // already returns unix ms timestamp
    }
    if (period === completedOrderHistoryDuration3m) {
      fresherThanUnixMs = new Date().setMonth(now.getMonth() - 3) // already returns unix ms timestamp
    }
    if (fresherThanUnixMs !== 0) {
      const filter: OrderFilter = {
        n: maxCompletedUserOrdersShown,
        fresherThanUnixMs: fresherThanUnixMs,
        hosts: [host],
        market: { baseID: b.id, quoteID: q.id },
        statuses: [OrderUtil.StatusUnknown, OrderUtil.StatusExecuted, OrderUtil.StatusCanceled, OrderUtil.StatusRevoked],
        completedOnly: true
      }
      const res = await postJSON('/api/orders', filter)
      completedUserOrders = res.orders || []
    }

    Doc.empty(page.completedUserOrders)
    Doc.setVis(completedUserOrders?.length, page.completedUserOrders)
    Doc.setVis(!completedUserOrders?.length, page.completedNoUserOrders)

    for (const ord of completedUserOrders) {
      const div = page.userOrderTmpl.cloneNode(true) as HTMLElement
      page.completedUserOrders.appendChild(div)
      const tmpl = Doc.parseTemplate(div)
      const header = Doc.parseTemplate(tmpl.header)
      const details = Doc.parseTemplate(tmpl.details)

      header.sideLight.classList.add(ord.sell ? 'sell' : 'buy')
      header.side.textContent = ord.sell ? 'sold' : 'bought'
      details.side.textContent = OrderUtil.sellString(ord)
      details.side.classList.add(ord.sell ? 'sellcolor' : 'buycolor')
      header.side.classList.add(ord.sell ? 'sellcolor' : 'buycolor')
      const settledFormatted = Doc.formatCoinAtomToLotSizeBaseCurrency(OrderUtil.settled(ord), market.baseUnitInfo, market.cfg.lotsize)
      header.qty.textContent = `${settledFormatted}`
      details.qty.textContent = Doc.formatCoinAtomToLotSizeBaseCurrency(ord.qty, market.baseUnitInfo, market.cfg.lotsize)
      let headerRateStr = Doc.formatRateAtomToRateStep(ord.rate, market.baseUnitInfo, market.quoteUnitInfo, market.cfg.ratestep, ord.sell)
      let detailsRateStr = Doc.formatRateAtomToRateStep(ord.rate, market.baseUnitInfo, market.quoteUnitInfo, market.cfg.ratestep, ord.sell)
      if (ord.type === OrderUtil.Market) {
        headerRateStr = this.marketOrderHeaderRateString(ord, market)
        detailsRateStr = this.marketOrderDetailsRateString(ord, market)
      }
      header.rate.textContent = `@ ${headerRateStr}`
      details.rate.textContent = detailsRateStr
      header.baseSymbol.textContent = market.baseUnitInfo.conventional.unit
      details.type.textContent = OrderUtil.orderTypeText(ord.type)
      header.status.textContent = Doc.ageSinceFromMs(ord.stamp)
      details.status.textContent = OrderUtil.statusString(ord)
      details.age.textContent = Doc.ageSinceFromMs(ord.stamp)
      details.filled.textContent = `${(OrderUtil.filled(ord) / ord.qty * 100).toFixed(1)}%`
      details.settled.textContent = `${(OrderUtil.settled(ord) / ord.qty * 100).toFixed(1)}%`

      if (!ord.id) {
        Doc.hide(details.link)
      } else {
        details.link.href = `order/${ord.id}`
        app().bindInternalNavigation(div)
      }
      let currentFloater: (PageElement | null)
      bind(tmpl.header, 'click', () => {
        if (Doc.isDisplayed(tmpl.details)) {
          Doc.hide(tmpl.details)
          return
        }
        Doc.show(tmpl.details)
        if (currentFloater) currentFloater.remove()
      })
      /**
       * We'll show the button menu when they hover over the header. To avoid
       * pushing the layout around, we'll show the buttons as an absolutely
       * positioned copy of the button menu.
       */
      bind(tmpl.header, 'mouseenter', () => {
        // Don't show the copy if the details are already displayed.
        if (Doc.isDisplayed(tmpl.details)) return
        if (currentFloater) currentFloater.remove()
        // Create and position the element based on the position of the header.
        const floater = document.createElement('div')
        currentFloater = floater
        document.body.appendChild(floater)
        floater.className = 'user-order-floaty-menu'
        const m = Doc.layoutMetrics(tmpl.header)
        const y = m.bodyTop + m.height
        floater.style.top = `${y - 1}px` // - 1 to hide border on header div
        floater.style.left = `${m.bodyLeft}px`
        floater.appendChild(details.link.cloneNode(true))

        const ogScrollY = page.orderScroller.scrollTop
        // Set up the hover interactions.
        const moved = (e: MouseEvent) => {
          // If the user scrolled, reposition the float menu. This keeps the
          // menu from following us around, which can prevent removal below.
          const yShift = page.orderScroller.scrollTop - ogScrollY
          floater.style.top = `${y + yShift}px`
          if (Doc.mouseInElement(e, floater) || Doc.mouseInElement(e, div)) return
          floater.remove()
          currentFloater = null
          document.removeEventListener('mousemove', moved)
          page.orderScroller.removeEventListener('scroll', moved)
        }
        document.addEventListener('mousemove', moved)
        page.orderScroller.addEventListener('scroll', moved)
      })
      app().bindTooltips(div)
    }
  }

  marketOrderHeaderRateString (ord: Order, mkt: CurrentMarket): string {
    if (!ord.matches?.length) return intl.prep(intl.ID_MARKET_ORDER)
    let rateStr = Doc.formatRateAtomToRateStep(OrderUtil.averageRate(ord), mkt.baseUnitInfo, mkt.quoteUnitInfo, mkt.cfg.ratestep)
    if (ord.matches.length > 1) rateStr = '~ ' + rateStr // ~ only makes sense if the order has more than one match
    return rateStr
  }

  marketOrderDetailsRateString (ord: Order, mkt: CurrentMarket): string {
    if (!ord.matches?.length) return intl.prep(intl.ID_MARKET_ORDER)
    let rateStr = Doc.formatRateAtomToRateStep(OrderUtil.averageRate(ord), mkt.baseUnitInfo, mkt.quoteUnitInfo, mkt.cfg.ratestep)
    if (ord.matches.length > 1) rateStr = '~ ' + rateStr // ~ only makes sense if the order has more than one match
    return rateStr
  }

  /*
  * updateMetaOrder sets the td contents of the user's order table row.
  */
  updateMetaOrder (mord: MetaOrder) {
    const { header, details, ord } = mord
    details.status.textContent = header.status.textContent = OrderUtil.statusString(ord)
    details.age.textContent = Doc.ageSinceFromMs(ord.submitTime)
    details.filled.textContent = `${(OrderUtil.filled(ord) / ord.qty * 100).toFixed(1)}%`
    details.settled.textContent = `${(OrderUtil.settled(ord) / ord.qty * 100).toFixed(1)}%`
  }

  /* updateTitle update the browser title based on the midgap value and the
   * selected assets.
   */
  updateTitle () {
    // gets first price value from buy or from sell, so we can show it on
    // title.
    const midGapValue = this.midGapRateConventional()
    const { baseUnitInfo: { conventional: { unit: bUnit } }, quoteUnitInfo: { conventional: { unit: qUnit } } } = this.market
    if (!midGapValue) document.title = `${bUnit}${qUnit} | ${this.ogTitle}`
    else document.title = `${Doc.formatCoinAtom(midGapValue)} | ${bUnit}${qUnit} | ${this.ogTitle}` // more than 6 numbers it gets too big for the title.
  }

  /* handleBookRoute is the handler for the 'book' notification, which is sent
   * in response to a new market subscription. The data received will contain
   * the entire order book.
   */
  handleBookRoute (note: BookUpdate) {
    app().log('book', 'handleBookRoute:', note)
    const mktBook: MarketOrderBook = note.payload
    const { baseCfg, quoteCfg, dex: { host } } = this.market
    if (mktBook.base !== baseCfg.id || mktBook.quote !== quoteCfg.id || note.host !== host) {
      return // user already changed markets
    }

    this.book = new OrderBook(mktBook, baseCfg.symbol, quoteCfg.symbol)
    this.loadTable()
    for (const order of (mktBook.book.epoch || [])) {
      if (order.rate > 0) this.book.add(order)
      this.addTableOrder(order)
    }

    this.recentMatches = mktBook.book.recentMatches ?? []
    this.refreshRecentMatchesTable()
    this.setCurrMarketPrice() // needs an update whenever matches update

    this.market.bookLoaded = true
    this.updateTitle()
  }

  /* handleBookOrderRoute is the handler for 'book_order' notifications. */
  handleBookOrderRoute (data: BookUpdate) {
    app().log('book', 'handleBookOrderRoute:', data)
    if (data.host !== this.market.dex.host || data.marketID !== this.market.name) return
    const order = data.payload as MiniOrder
    if (order.rate > 0) this.book.add(order)
    this.addTableOrder(order)
    this.updateTitle()
  }

  /* handleUnbookOrderRoute is the handler for 'unbook_order' notifications. */
  handleUnbookOrderRoute (data: BookUpdate) {
    app().log('book', 'handleUnbookOrderRoute:', data)
    if (data.host !== this.market.dex.host || data.marketID !== this.market.name) return
    const order = data.payload
    this.book.remove(order.id)
    this.removeTableOrder(order)
    this.updateTitle()
  }

  /*
   * handleUpdateRemainingRoute is the handler for 'update_remaining'
   * notifications.
   */
  handleUpdateRemainingRoute (data: BookUpdate) {
    app().log('book', 'handleUpdateRemainingRoute:', data)
    if (data.host !== this.market.dex.host || data.marketID !== this.market.name) return
    const update = data.payload
    this.book.updateRemaining(update.token, update.qty, update.qtyAtomic)
    this.updateTableOrder(update)
  }

  /* handleEpochOrderRoute is the handler for 'epoch_order' notifications. */
  handleEpochOrderRoute (data: BookUpdate) {
    app().log('book', 'handleEpochOrderRoute:', data)
    if (data.host !== this.market.dex.host || data.marketID !== this.market.name) return
    const order = data.payload
    if (order.msgRate > 0) this.book.add(order) // No cancels or market orders
    if (order.qtyAtomic > 0) this.addTableOrder(order) // No cancel orders
  }

  /* handleCandlesRoute is the handler for 'candles' notifications. */
  handleCandlesRoute (data: BookUpdate) {
    if (data.host !== this.market.dex.host || data.marketID !== this.market.cfg.name) return
    if (!data.payload || !data.payload.candles) return

    // update cache
    const dur = data.payload.dur
    this.market.candleCaches[dur] = data.payload
    if (this.reqCandleDuration !== dur) return

    this.candleChart.setMarketId(data.marketID) // market has changed, gotta update it
    this.candleChart.resize() // adjust chart size(s) according to what this market needs
    this.candleChart.setCandlesAndDraw(data.payload, this.market.cfg, this.market.baseUnitInfo, this.market.quoteUnitInfo)

    if (this.loadingAnimations.candles) {
      this.loadingAnimations.candles.stop() // just a cleanup
      this.loadingAnimations.candles = undefined // signals we are not on animation screen anymore
      this.candleChart.canvas.classList.remove('invisible') // everything is ready, show the chart
    }

    this.setHighLow()
  }

  handleEpochMatchSummary (data: BookUpdate) {
    this.addRecentMatches(data.payload.matchSummaries)
    this.refreshRecentMatchesTable()
    this.setCurrMarketPrice() // needs an update whenever matches update
  }

  /* handleCandleUpdateRoute is the handler for 'candle_update' notifications. */
  handleCandleUpdateRoute (data: BookUpdate) {
    if (data.host !== this.market.dex.host) return
    const { dur, candle } = data.payload
    const cache = this.market.candleCaches[dur]
    if (!cache) return // must not have seen the 'candles' notification yet?
    const candles = cache.candles
    if (candles.length === 0) candles.push(candle)
    else {
      const last = candles[candles.length - 1]
      if (last.startStamp === candle.startStamp) candles[candles.length - 1] = candle
      else candles.push(candle)
    }
    if (this.reqCandleDuration !== dur) return
    this.candleChart.draw()
  }

  /*
   * toggleWalletStatus toggle wallets status to enabled.
   */
  async toggleWalletStatus () {
    const page = this.page
    Doc.hide(page.toggleWalletStatusErr)

    const url = '/api/togglewalletstatus'
    const req = {
      assetID: this.openAsset.id,
      disable: false
    }

    const loaded = app().loading(page.toggleWalletStatusConfirm)
    const res = await postJSON(url, req)
    loaded()
    if (!app().checkResponse(res)) {
      page.toggleWalletStatusErr.textContent = res.msg
      Doc.show(page.toggleWalletStatusErr)
      return
    }

    Doc.hide(this.page.forms)
  }

  /* showVerify shows the form to accept the currently parsed order information
   * and confirm submission of the order to the dex.
   */
  async showVerify (order: TradeForm) {
    const page = this.page
    const mkt = this.market
    const isSell = order.sell
    const baseAsset = app().assets[order.base]
    const quoteAsset = app().assets[order.quote]

    // if there was an error shown previously on order-limit forms - it's no longer relevant,
    // we should hide it (doing it here is the least distracting way to do it)
    Doc.hide(page.orderErrBuy)
    Doc.hide(page.orderErrSell)

    page.vBuySell.textContent = isSell ? intl.prep(intl.ID_SELLING) : intl.prep(intl.ID_BUYING)
    const buySellStr = isSell ? intl.prep(intl.ID_SELL) : intl.prep(intl.ID_BUY)
    page.vSideSubmit.textContent = buySellStr
    page.vOrderHost.textContent = order.host
    Doc.show(page.verifyLimit)
    const orderDesc = `Limit ${buySellStr} Order`
    page.vOrderType.textContent = order.tifnow ? orderDesc + ' (immediate)' : orderDesc
    page.vRate.textContent = Doc.formatRateAtomToRateStep(
      order.rate,
      mkt.baseUnitInfo,
      mkt.quoteUnitInfo,
      mkt.cfg.ratestep,
      isSell
    )

    let youSpendAsset = quoteAsset
    let youSpendTotal = order.qty * order.rate / OrderUtil.RateEncodingFactor
    let youSpendTotalFormatted = Doc.formatCoinAtomToLotSizeQuoteCurrency(
      youSpendTotal,
      mkt.baseUnitInfo,
      mkt.quoteUnitInfo,
      mkt.cfg.lotsize,
      mkt.cfg.ratestep
    )
    let youGetTotal = order.qty
    let youGetTotalFormatted = Doc.formatCoinAtomToLotSizeBaseCurrency(
      youGetTotal,
      mkt.baseUnitInfo,
      mkt.cfg.lotsize
    )
    let youGetAsset = baseAsset
    if (isSell) {
      youSpendTotal = order.qty
      youSpendTotalFormatted = Doc.formatCoinAtomToLotSizeBaseCurrency(
        youSpendTotal,
        mkt.baseUnitInfo,
        mkt.cfg.lotsize
      )
      youSpendAsset = baseAsset
      youGetTotal = order.qty * order.rate / OrderUtil.RateEncodingFactor
      youGetTotalFormatted = Doc.formatCoinAtomToLotSizeQuoteCurrency(
        youGetTotal,
        mkt.baseUnitInfo,
        mkt.quoteUnitInfo,
        mkt.cfg.lotsize,
        mkt.cfg.ratestep
      )
      youGetAsset = quoteAsset
    }
    page.youSpend.textContent = '-' + youSpendTotalFormatted
    page.youSpendTicker.textContent = youSpendAsset.unitInfo.conventional.unit
    page.youGet.textContent = '+' + youGetTotalFormatted
    page.youGetTicker.textContent = youGetAsset.unitInfo.conventional.unit
    // Format total fiat value.
    this.showFiatValue(youGetAsset.id, youGetTotal, page.vFiatTotal)

    // Visually differentiate between buy/sell orders.
    if (isSell) {
      page.vHeader.classList.add(sellBtnClass)
      page.vHeader.classList.remove(buyBtnClass)
      page.vSubmit.classList.add(sellBtnClass)
      page.vSubmit.classList.remove(buyBtnClass)
    } else {
      page.vHeader.classList.add(buyBtnClass)
      page.vHeader.classList.remove(sellBtnClass)
      page.vSubmit.classList.add(buyBtnClass)
      page.vSubmit.classList.remove(sellBtnClass)
    }
    await this.showVerifyForm()
  }

  // showFiatValue displays the fiat equivalent for an order quantity.
  showFiatValue (assetID: number, qty: number, display: PageElement) {
    if (display) {
      const rate = app().fiatRatesMap[assetID]
      display.textContent = Doc.formatFiatConversion(qty, rate, app().unitInfo(assetID))
      if (rate) Doc.show(display.parentElement as Element)
      else Doc.hide(display.parentElement as Element)
    }
  }

  /* showVerifyForm displays form to verify an order */
  async showVerifyForm () {
    const page = this.page
    Doc.hide(page.vErr)
    await this.forms.show(page.verifyForm)
  }

  /*
   * stepSubmitBuy will examine the current state of wallets and step the user
   * through the process of order submission.
   * NOTE: I expect this process will be streamlined soon such that the wallets
   * will attempt to be unlocked in the order submission process, negating the
   * need to unlock ahead of time.
   */
  async stepSubmitBuy () {
    const page = this.page
    const market = this.market

    const showError = function (err: string, args?: Record<string, string>) {
      page.orderErrBuy.textContent = intl.prep(err, args)
      Doc.show(page.orderErrBuy)
    }

    const order = this.buildOrderBuy()
    if (!await this.validateOrderBuy(order)) {
      return
    }

    const baseWallet = app().walletMap[market.base.id]
    const quoteWallet = app().walletMap[market.quote.id]
    if (!baseWallet) {
      showError(intl.ID_NO_ASSET_WALLET, { asset: market.base.symbol })
      return
    }
    if (!quoteWallet) {
      showError(intl.ID_NO_ASSET_WALLET, { asset: market.quote.symbol })
      return
    }
    this.verifiedOrder = order
    await this.showVerify(this.verifiedOrder)
  }

  /*
   * stepSubmitSell will examine the current state of wallets and step the user
   * through the process of order submission.
   * NOTE: I expect this process will be streamlined soon such that the wallets
   * will attempt to be unlocked in the order submission process, negating the
   * need to unlock ahead of time.
   */
  async stepSubmitSell () {
    const page = this.page
    const market = this.market

    const showError = function (err: string, args?: Record<string, string>) {
      page.orderErrSell.textContent = intl.prep(err, args)
      Doc.show(page.orderErrSell)
    }

    const order = this.buildOrderSell()
    if (!await this.validateOrderSell(order)) {
      return
    }

    const baseWallet = app().walletMap[market.base.id]
    const quoteWallet = app().walletMap[market.quote.id]
    if (!baseWallet) {
      showError(intl.ID_NO_ASSET_WALLET, { asset: market.base.symbol })
      return
    }
    if (!quoteWallet) {
      showError(intl.ID_NO_ASSET_WALLET, { asset: market.quote.symbol })
      return
    }
    this.verifiedOrder = order
    await this.showVerify(this.verifiedOrder)
  }

  /*
   * handlePriceUpdate is the handler for the 'spots' notification.
   */
  handlePriceUpdate (note: SpotPriceNote) {
    if (!this.market) return // This note can arrive before the market is set.
    if (note.host === this.market.dex.host && note.spots[this.market.cfg.name]) {
      this.setCurrMarketPrice()
    }
  }

  handleWalletState (note: WalletStateNote) {
    if (!this.market) return // This note can arrive before the market is set.
    // if (note.topic !== 'TokenApproval') return
    if (note.wallet.assetID !== this.market.base?.id && note.wallet.assetID !== this.market.quote?.id) return
    this.setTokenApprovalVisibility()
    this.resolveOrderVsMMForm()
  }

  /*
   * handleBondUpdate is the handler for the 'bondpost' notification type.
   * This is used to update the registration status of the current exchange.
   */
  async handleBondUpdate (note: BondNote) {
    const dexAddr = note.dex
    if (!this.market) return // This note can arrive before the market is set.
    if (dexAddr !== this.market.dex.host) return
    // If we just finished legacy registration, we need to update the Exchange.
    // TODO: Use tier change notification once available.
    if (note.topic === 'AccountRegistered') await app().fetchUser()
    // Update local copy of Exchange.
    this.market.dex = app().exchanges[dexAddr]
    this.setRegistrationStatusVisibility()
    this.updateReputation()
  }

  updateReputation () {
    const { page, market: { dex: { host }, cfg: mkt, baseCfg: { unitInfo: bui }, quoteCfg: { unitInfo: qui } } } = this
    const { auth } = app().exchanges[host]

    page.parcelSizeLots.textContent = String(mkt.parcelsize)
    page.marketLimitBase.textContent = Doc.formatBestWeCan(mkt.parcelsize * mkt.lotsize / bui.conventional.conversionFactor)
    page.marketLimitBaseUnit.textContent = bui.conventional.unit
    page.marketLimitQuoteUnit.textContent = qui.conventional.unit
    const conversionRate = this.anyRate()[1]
    if (conversionRate) {
      const qty = mkt.lotsize * conversionRate
      page.marketLimitQuote.textContent = Doc.formatBestWeCan(mkt.parcelsize * qty / qui.conventional.conversionFactor)
    } else page.marketLimitQuote.textContent = '-'

    const tier = strongTier(auth)
    page.tradingTier.textContent = String(tier)
    const [usedParcels, parcelLimit] = tradingLimits(host)
    page.tradingLimit.textContent = (parcelLimit * mkt.parcelsize).toFixed(2)
    page.limitUsage.textContent = parcelLimit > 0 ? (usedParcels / parcelLimit * 100).toFixed(1) : '0'

    this.reputationMeter.update()
  }

  /*
   * anyRate finds the best rate from any of, in order of priority, the order
   * book, the server's reported spot rate, or the fiat exchange rates. A
   * 3-tuple of message-rate encoding (atoms), an inverted rate, and a conventional
   * rate is generated.
   * Returns [0, 0, 0] if none of the rate sources are able to provide rate.
   */
  anyRate (): [number, number, number] {
    const { cfg: { spot }, rateConversionFactor, bookLoaded } = this.market

    if (bookLoaded) {
      const midGapAtom = this.midGapRateAtom()
      if (midGapAtom) {
        return [midGapAtom, midGapAtom / OrderUtil.RateEncodingFactor, midGapAtom / rateConversionFactor || 0]
      }
    }

    if (spot && spot.rate) {
      return [spot.rate, spot.rate / OrderUtil.RateEncodingFactor, spot.rate / rateConversionFactor]
    }

    const [msgRate, conventionalRate] = this.fiatRate()
    if (msgRate > 0) {
      const invertedRate = msgRate / OrderUtil.RateEncodingFactor
      return [msgRate, invertedRate, conventionalRate]
    }

    return [0, 0, 0]
  }

  /*
   * fiatRate returns fiat rate as 2-tuple of message-rate encoding (atoms) and a conventional.
   * Returns [0, 0] if fiat rate isn't available.
   */
  fiatRate (): [number, number] {
    const { baseCfg: { id: baseID }, quoteCfg: { id: quoteID }, rateConversionFactor } = this.market
    const [baseUSD, quoteUSD] = [app().fiatRatesMap[baseID], app().fiatRatesMap[quoteID]]
    if (baseUSD && quoteUSD) {
      const conventionalRate = baseUSD / quoteUSD
      const msgRate = conventionalRate * rateConversionFactor
      return [msgRate, conventionalRate]
    }
    return [0, 0]
  }

  handleMatchNote (note: MatchNote) {
    const mord = this.recentlyActiveUserOrders[note.orderID]
    const match = note.match
    if (!mord) return this.refreshRecentlyActiveOrders()
    else if (mord.ord.type === OrderUtil.Market && match.status === OrderUtil.NewlyMatched) { // Update the average market rate display.
      // Fetch and use the updated order.
      const ord = app().order(note.orderID)
      if (ord) {
        mord.header.rate.textContent = this.marketOrderHeaderRateString(ord, this.market)
        mord.details.rate.textContent = this.marketOrderDetailsRateString(ord, this.market)
      }
    }
    if (
      (match.side === OrderUtil.MatchSideMaker && match.status === OrderUtil.MakerRedeemed) ||
      (match.side === OrderUtil.MatchSideTaker && match.status === OrderUtil.MatchComplete)
    ) this.updateReputation()
  }

  /*
   * handleOrderNote is the handler for the 'order'-type notification, which are
   * used to update a user's order's status.
   */
  handleOrderNote (note: OrderNote) {
    const ord = note.order
    const mord = this.recentlyActiveUserOrders[ord.id]
    // - If metaOrder doesn't exist for the given order it means it was created
    //  via bwctl and the GUI isn't aware of it, or it was an inflight order.
    //  refreshRecentlyActiveOrders must be called to grab this order.
    // - If an OrderLoaded notification is received, it means an order that was
    //   previously not "ready to tick" (due to its wallets not being connected
    //   and unlocked) has now become ready to tick. The active orders section
    //   needs to be refreshed.
    const wasInflight = note.topic === 'AsyncOrderFailure' || note.topic === 'AsyncOrderSubmitted'
    if (!mord || wasInflight || (note.topic === 'OrderLoaded' && ord.readyToTick)) {
      return this.refreshRecentlyActiveOrders()
    }
    const oldStatus = mord.ord.status
    mord.ord = ord
    if (note.topic === 'MissedCancel') Doc.show(mord.details.cancelBttn)
    if (ord.filled === ord.qty) Doc.hide(mord.details.cancelBttn)
    this.updateMetaOrder(mord)
    // Only reset markers if there is a change, since the chart is redrawn.
    if (
      (oldStatus === OrderUtil.StatusEpoch && ord.status === OrderUtil.StatusBooked) ||
      (oldStatus === OrderUtil.StatusBooked && ord.status > OrderUtil.StatusBooked)
    ) {
      this.updateReputation()
    }
  }

  /*
   * handleEpochNote handles notifications signalling the start of a new epoch.
   */
  handleEpochNote (note: EpochNote) {
    app().log('book', 'handleEpochNote:', note)
    if (!this.market) return // This note can arrive before the market is set.
    if (note.host !== this.market.dex.host || note.marketID !== this.market.name) return
    if (this.book) {
      this.book.setEpoch(note.epoch)
    }

    this.clearOrderTableEpochs()
    for (const { ord, details, header } of Object.values(this.recentlyActiveUserOrders)) {
      const alreadyMatched = note.epoch > ord.epoch
      switch (true) {
        case ord.type === OrderUtil.Limit && ord.status === OrderUtil.StatusEpoch && alreadyMatched: {
          const status = ord.tif === OrderUtil.ImmediateTiF ? intl.prep(intl.ID_EXECUTED) : intl.prep(intl.ID_BOOKED)
          details.status.textContent = header.status.textContent = status
          ord.status = ord.tif === OrderUtil.ImmediateTiF ? OrderUtil.StatusExecuted : OrderUtil.StatusBooked
          break
        }
        case ord.type === OrderUtil.Market && ord.status === OrderUtil.StatusEpoch:
          // Technically don't know if this should be 'executed' or 'settling'.
          details.status.textContent = header.status.textContent = intl.prep(intl.ID_EXECUTED)
          ord.status = OrderUtil.StatusExecuted
          break
      }
    }
  }

  recentMatchesSorted (sortBy: string, direction: number): RecentMatch[] {
    switch (sortBy) {
      case 'price':
        return this.recentMatches.sort((a: RecentMatch, b: RecentMatch) => direction * (a.rate - b.rate))
      case 'qty':
        return this.recentMatches.sort((a: RecentMatch, b: RecentMatch) => direction * (a.qty - b.qty))
      case 'age':
        return this.recentMatches.sort((a: RecentMatch, b:RecentMatch) => direction * (a.stamp - b.stamp))
      default:
        return []
    }
  }

  refreshRecentMatchesTable () {
    const page = this.page
    const mkt = this.market

    Doc.empty(page.recentMatchesLiveList)
    let recentMatchesSorted = this.recentMatchesSorted(this.recentMatchesSortKey, this.recentMatchesSortDirection)
    if (!recentMatchesSorted) return

    // filter out older matches to keep list reasonably short and show only relevant ones
    const now = new Date().getTime()
    const hour = 60 * 60 * 1000
    recentMatchesSorted = recentMatchesSorted.filter(match => {
      return now - match.stamp <= 24 * hour
    })

    for (const match of recentMatchesSorted) {
      const row = page.recentMatchesTemplate.cloneNode(true) as HTMLElement
      const tmpl = Doc.parseTemplate(row)
      app().bindTooltips(row)
      const isSell = !match.sell // for match (when rate-formatting) the meaning of sell is reversed
      tmpl.price.textContent = Doc.formatRateAtomToRateStep(match.rate, mkt.baseUnitInfo, mkt.quoteUnitInfo, mkt.cfg.ratestep, isSell)
      tmpl.price.classList.add(match.sell ? 'sellcolor' : 'buycolor')
      tmpl.qty.textContent = Doc.formatCoinAtomToLotSizeBaseCurrency(match.qty, mkt.baseUnitInfo, mkt.cfg.lotsize)
      tmpl.qty.classList.add(match.sell ? 'sellcolor' : 'buycolor')
      tmpl.age.textContent = Doc.ageSinceFromMs(match.stamp, true)
      tmpl.age.dataset.timestampMs = String(match.stamp)
      page.recentMatchesLiveList.append(row)
    }
  }

  addRecentMatches (matches: RecentMatch[]) {
    this.recentMatches = [...matches, ...this.recentMatches].slice(0, 100)
  }

  /* handleBalanceNote handles notifications updating a wallet's balance. */
  handleBalanceNote (note: BalanceNote) {
    this.approveTokenForm.handleBalanceNote(note)
    // if connection to dex server fails, it is not possible to retrieve
    // markets.
    const mkt = this.market
    if (!mkt || !mkt.dex || mkt.dex.connectionStatus !== ConnectionStatus.Connected) return

    // If there's a balance update, refresh the max order section.
    const avail = note.balance.available
    if (note.assetID === mkt.quoteCfg.id) {
      if (mkt.buyBalance !== avail) {
        // balance changed since we cached our buy estimates - that means now
        // they are WRONG (all of them), we should flush cache with old values here
        mkt.maxBuys = {}
      }
      if (this.chosenRateBuyAtom) { // can only fetch max buy estimate if we have some chosen rate
        this.previewMaxBuy()
      }
    }
    if (note.assetID === mkt.baseCfg.id) {
      if (mkt.sellBalance !== avail) {
        // balance changed since we cached our sell estimate - that means now
        // it is WRONG, we should flush cache with old value here
        mkt.maxSell = null
      }
      this.previewMaxSell()
    }
  }

  /*
   * submitVerifiedOrder is attached to the affirmative button on the order validation
   * form. Clicking the button is the last step in the order submission process.
   */
  async submitVerifiedOrder () {
    const page = this.page
    Doc.hide(page.vErr)
    const req = { order: wireOrder(this.verifiedOrder) }
    // Show loader and hide submit button.
    page.vSubmit.classList.add('d-hide')
    page.vLoader.classList.remove('d-hide')
    Doc.hide(page.vSubmit)
    Doc.show(page.vLoader)
    const res = await postJSON('/api/tradeasync', req)
    Doc.hide(page.vLoader)
    Doc.show(page.vSubmit)
    // If error, display error on confirmation modal.
    if (!app().checkResponse(res)) {
      page.vErr.textContent = res.msg
      Doc.show(page.vErr)
      return
    }

    // reset qty & slider to default values and re-render corresponding order-form (doing this only
    // for the affected form since max buy/sell changed for it, but not for the other order-form)
    if (!this.verifiedOrder.sell) {
      this.setBuyQtyDefault()
      await this.renderBuyForm()
    } else {
      this.setSellQtyDefault()
      await this.renderSellForm()
    }

    // Hide confirmation modal only on success.
    Doc.hide(page.forms)
    // refreshing UI orders with delay as a work-around for the fact that application
    // notifications handling code doesn't provide any callback mechanism we can hook
    // into to execute this exactly when we need to
    setTimeout(() => {
      this.refreshRecentlyActiveOrders()
    }, 1000) // 1000ms delay
  }

  setBuyQtyDefault () {
    const page = this.page
    const mkt = this.market

    this.chosenQtyBuyAtom = this.lotToQtyAtom(1)
    page.qtyFieldBuy.value = Doc.formatCoinAtomToLotSizeBaseCurrency(
      this.chosenQtyBuyAtom,
      mkt.baseUnitInfo,
      mkt.cfg.lotsize
    )
    page.qtySliderBuyInput.value = '0'
  }

  setSellQtyDefault () {
    const page = this.page
    const mkt = this.market

    this.chosenQtySellAtom = this.lotToQtyAtom(1)
    page.qtyFieldSell.value = Doc.formatCoinAtomToLotSizeBaseCurrency(
      this.chosenQtySellAtom,
      mkt.baseUnitInfo,
      mkt.cfg.lotsize
    )
    page.qtySliderSellInput.value = '0'
  }

  /*
   * createWallet is attached to successful submission of the wallet creation
   * form. createWallet is only called once the form is submitted and a success
   * response is received from the client.
   */
  async createWallet () {
    const user = await app().fetchUser()
    if (!user) return
    const asset = user.assets[this.currentCreate.id]
    Doc.hide(this.page.forms)
    const mkt = this.market
    if (mkt.baseCfg.id === asset.id) mkt.base = asset
    else if (mkt.quoteCfg.id === asset.id) mkt.quote = asset
    this.displayMessageIfMissingWallet()
    this.resolveOrderVsMMForm()
  }

  rateFieldBuyInputHandler () {
    const rateFieldValue = this.page.rateFieldBuy.value?.trim()

    // allow a '.' (or ',') that's typical for decimals - just wait for the next input since
    // the input might not be "final", let the 'change' handler to take care of it in case it
    // is "final"
    if ((rateFieldValue && rateFieldValue.length > 0) &&
        ((rateFieldValue.charAt(rateFieldValue.length - 1) === '.' &&
        rateFieldValue.indexOf('.') === rateFieldValue.length - 1) ||
        ((rateFieldValue.charAt(rateFieldValue.length - 1) === '.' &&
        rateFieldValue.indexOf(',') === rateFieldValue.length - 1)))) {
      return
    }

    const [inputValid, adjusted, adjRateAtom] = this.parseRateInput(rateFieldValue)
    if (!inputValid || adjusted) {
      // we don't want to do any further processing here since the input might not be "final",
      // let the 'change' handler to take care of it in case it is "final"
      return
    }

    // process "perfect" user input

    this.chosenRateBuyAtom = adjRateAtom

    this.renderBuyForm()
  }

  rateFieldBuyChangeHandler () {
    const page = this.page
    const mkt = this.market

    const rateFieldValue = this.page.rateFieldBuy.value?.trim()

    const [inputValid, adjusted, adjRateAtom] = this.parseRateInput(rateFieldValue)
    if (!inputValid || adjusted) {
      // Let the user know that rate he's entered is invalid or was rounded down.
      this.animateErrors(highlightOutlineRed(page.priceBoxBuy))
    }
    if (!inputValid || (adjusted && adjRateAtom === 0)) {
      this.chosenRateBuyAtom = 0 // reset chosen value, but don't interfere with user input field
      this.previewTotalBuy(this.chosenRateBuyAtom, this.chosenQtyBuyAtom)
      this.setOrderBttnBuyEnabled(false, 'choose your price')
      return
    }
    if (!adjusted) {
      // non-adjusted user input has already been processed by 'input' handler, nothing to do here
      return
    }

    // process "imperfect" (adjusted) user input

    page.rateFieldBuy.value = Doc.formatRateAtomToRateStep(
      adjRateAtom,
      mkt.baseUnitInfo,
      mkt.quoteUnitInfo,
      mkt.cfg.ratestep
    )
    this.chosenRateBuyAtom = adjRateAtom

    this.renderBuyForm()
  }

  rateFieldBuyUpHandler () {
    const page = this.page
    const mkt = this.market
    const rateStepAtom = this.market.cfg.ratestep

    this.chosenRateBuyAtom = this.chosenRateBuyAtom + rateStepAtom
    page.rateFieldBuy.value = Doc.formatRateAtomToRateStep(
      this.chosenRateBuyAtom,
      mkt.baseUnitInfo,
      mkt.quoteUnitInfo,
      mkt.cfg.ratestep
    )

    this.renderBuyForm()
  }

  rateFieldBuyDownHandler () {
    const page = this.page
    const mkt = this.market
    const rateStepAtom = this.market.cfg.ratestep

    this.chosenRateBuyAtom = Math.max(0, this.chosenRateBuyAtom - rateStepAtom) // don't allow negative values
    page.rateFieldBuy.value = Doc.formatRateAtomToRateStep(
      this.chosenRateBuyAtom,
      mkt.baseUnitInfo,
      mkt.quoteUnitInfo,
      mkt.cfg.ratestep
    )

    this.renderBuyForm()
  }

  rateFieldSellInputHandler () {
    const rateFieldValue = this.page.rateFieldSell.value?.trim()

    // allow a '.' (or ',') that's typical for decimals - just wait for the next input since
    // the input might not be "final", let the 'change' handler to take care of it in case it
    // is "final"
    if ((rateFieldValue && rateFieldValue.length > 0) &&
        ((rateFieldValue.charAt(rateFieldValue.length - 1) === '.' &&
          rateFieldValue.indexOf('.') === rateFieldValue.length - 1) ||
        ((rateFieldValue.charAt(rateFieldValue.length - 1) === '.' &&
          rateFieldValue.indexOf(',') === rateFieldValue.length - 1)))) {
      return
    }

    const [inputValid, adjusted, adjRateAtom] = this.parseRateInput(rateFieldValue)
    if (!inputValid || adjusted) {
      // we don't want to do any further processing here since the input might not be "final",
      // let the 'change' handler to take care of it in case it is "final"
      return
    }

    // process "perfect" user input

    this.chosenRateSellAtom = adjRateAtom

    // unlike with buy orders there is no need to recalculate maxsell value
    // because it doesn't change with the rate/price change.
    this.renderSellForm()
  }

  rateFieldSellChangeHandler () {
    const page = this.page
    const mkt = this.market

    const rateFieldValue = this.page.rateFieldSell.value?.trim()

    const [inputValid, adjusted, adjRateAtom] = this.parseRateInput(rateFieldValue)
    if (!inputValid || adjusted) {
      // Let the user know that rate he's entered is invalid or was rounded down.
      this.animateErrors(highlightOutlineRed(page.priceBoxSell))
    }
    if (!inputValid || (adjusted && adjRateAtom === 0)) {
      this.chosenRateSellAtom = 0 // reset chosen value, but don't interfere with user input field
      this.previewTotalSell(this.chosenRateSellAtom, this.chosenQtySellAtom)
      this.setOrderBttnSellEnabled(false, 'choose your price')
      return
    }
    if (!adjusted) {
      // non-adjusted user input has already been processed by 'input' handler, nothing to do here
      return
    }

    // process "imperfect" (adjusted) user input

    page.rateFieldSell.value = Doc.formatRateAtomToRateStep(
      adjRateAtom,
      mkt.baseUnitInfo,
      mkt.quoteUnitInfo,
      mkt.cfg.ratestep
    )
    this.chosenRateSellAtom = adjRateAtom

    // unlike with buy orders there is no need to recalculate maxsell value
    // because it doesn't change with the rate/price change.
    this.renderSellForm()
  }

  rateFieldSellUpHandler () {
    const page = this.page
    const mkt = this.market
    const rateStepAtom = this.market.cfg.ratestep

    this.chosenRateSellAtom = this.chosenRateSellAtom + rateStepAtom
    page.rateFieldSell.value = Doc.formatRateAtomToRateStep(
      this.chosenRateSellAtom,
      mkt.baseUnitInfo,
      mkt.quoteUnitInfo,
      mkt.cfg.ratestep
    )

    // recalculate maxsell value because it does change with every rate change
    this.renderSellForm()
  }

  rateFieldSellDownHandler () {
    const page = this.page
    const mkt = this.market
    const rateStepAtom = this.market.cfg.ratestep

    this.chosenRateSellAtom = Math.max(0, this.chosenRateSellAtom - rateStepAtom) // don't allow negative values
    page.rateFieldSell.value = Doc.formatRateAtomToRateStep(
      this.chosenRateSellAtom,
      mkt.baseUnitInfo,
      mkt.quoteUnitInfo,
      mkt.cfg.ratestep
    )

    // recalculate maxsell value because it does change with every rate change
    this.renderSellForm()
  }

  qtyFieldBuyInputHandler () {
    const page = this.page

    const qtyFieldValue = page.qtyFieldBuy.value?.trim()

    // allow a '.' (or ',') that's typical for decimals - just wait for the next input since
    // the input might not be "final", let the 'change' handler to take care of it in case it
    // is "final"
    if ((qtyFieldValue && qtyFieldValue.length > 0) &&
        ((qtyFieldValue.charAt(qtyFieldValue.length - 1) === '.' &&
          qtyFieldValue.indexOf('.') === qtyFieldValue.length - 1) ||
        ((qtyFieldValue.charAt(qtyFieldValue.length - 1) === '.' &&
          qtyFieldValue.indexOf(',') === qtyFieldValue.length - 1)))) {
      return
    }

    const [inputValid, adjusted, adjLots, adjQtyAtom] = this.parseQtyInput(qtyFieldValue)
    if (!inputValid || adjusted) {
      // we don't want to do any further processing here since the input might not be "final",
      // let the 'change' handler to take care of it in case it is "final"
      return
    }

    // process "perfect" user input

    this.chosenQtyBuyAtom = adjQtyAtom

    this.setSliderBuyInput(adjLots) // update slider accordingly

    this.renderBuyForm()
  }

  qtyFieldBuyChangeHandler () {
    const page = this.page
    const mkt = this.market

    const qtyFieldValue = page.qtyFieldBuy.value?.trim()

    const [inputValid, adjusted, adjLots, adjQtyAtom] = this.parseQtyInput(qtyFieldValue)
    if (!inputValid || adjusted) {
      // Let the user know that quantity he's entered was rounded down.
      this.animateErrors(highlightOutlineRed(page.qtyBoxBuy))
    }
    if (!inputValid || (adjusted && adjQtyAtom === 0)) {
      this.chosenQtyBuyAtom = 0 // reset chosen value, but don't interfere with user input field
      this.previewTotalBuy(this.chosenRateBuyAtom, this.chosenQtyBuyAtom)
      this.setOrderBttnBuyEnabled(false, 'choose your quantity')
      return
    }
    if (!adjusted) {
      // non-adjusted user input has already been processed by 'input' handler, nothing to do here
      return
    }

    // process "imperfect" (adjusted) user input

    page.qtyFieldBuy.value = Doc.formatCoinAtomToLotSizeBaseCurrency(
      adjQtyAtom,
      mkt.baseUnitInfo,
      mkt.cfg.lotsize
    )
    this.chosenQtyBuyAtom = adjQtyAtom

    this.setSliderBuyInput(adjLots) // update slider accordingly

    this.renderBuyForm()
  }

  qtyFieldBuyUpHandler () {
    const page = this.page
    const mkt = this.market

    const qtyIncrement = this.lotToQtyAtom(1)
    this.chosenQtyBuyAtom = this.chosenQtyBuyAtom + qtyIncrement
    page.qtyFieldBuy.value = Doc.formatCoinAtomToLotSizeBaseCurrency(
      this.chosenQtyBuyAtom,
      mkt.baseUnitInfo,
      mkt.cfg.lotsize
    )

    const [, chosenLots] = this.adjustQtyAtoms(this.chosenQtyBuyAtom)
    this.setSliderBuyInput(chosenLots) // update slider accordingly

    this.renderBuyForm()
  }

  qtyFieldBuyDownHandler () {
    const page = this.page
    const mkt = this.market

    const qtyDecrement = this.lotToQtyAtom(1)
    this.chosenQtyBuyAtom = Math.max(0, this.chosenQtyBuyAtom - qtyDecrement) // don't allow negative values
    page.qtyFieldBuy.value = Doc.formatCoinAtomToLotSizeBaseCurrency(
      this.chosenQtyBuyAtom,
      mkt.baseUnitInfo,
      mkt.cfg.lotsize
    )

    const [, chosenLots] = this.adjustQtyAtoms(this.chosenQtyBuyAtom)
    this.setSliderBuyInput(chosenLots) // update slider accordingly

    this.renderBuyForm()
  }

  qtyFieldSellInputHandler () {
    const page = this.page

    const qtyFieldValue = page.qtyFieldSell.value?.trim()

    // allow a '.' (or ',') that's typical for decimals - just wait for the next input since
    // the input might not be "final", let the 'change' handler to take care of it in case it
    // is "final"
    if ((qtyFieldValue && qtyFieldValue.length > 0) &&
        ((qtyFieldValue.charAt(qtyFieldValue.length - 1) === '.' &&
          qtyFieldValue.indexOf('.') === qtyFieldValue.length - 1) ||
        ((qtyFieldValue.charAt(qtyFieldValue.length - 1) === '.' &&
          qtyFieldValue.indexOf(',') === qtyFieldValue.length - 1)))) {
      return
    }

    const [inputValid, adjusted, adjLots, adjQtyAtom] = this.parseQtyInput(qtyFieldValue)
    if (!inputValid || adjusted) {
      // we don't want to do any further processing here since the input might not be "final",
      // let the 'change' handler to take care of it in case it is "final"
      return
    }

    // process "perfect" user input

    this.chosenQtySellAtom = adjQtyAtom

    this.setSliderSellInput(adjLots) // update slider accordingly

    this.renderSellForm()
  }

  qtyFieldSellChangeHandler () {
    const page = this.page
    const mkt = this.market

    const qtyFieldValue = page.qtyFieldSell.value?.trim()

    const [inputValid, adjusted, adjLots, adjQtyAtom] = this.parseQtyInput(qtyFieldValue)
    if (!inputValid || adjusted) {
      // Let the user know that quantity he's entered was rounded down.
      this.animateErrors(highlightOutlineRed(page.qtyBoxSell))
    }
    if (!inputValid || (adjusted && adjQtyAtom === 0)) {
      this.chosenQtySellAtom = 0 // reset chosen value, but don't interfere with user input field
      this.setOrderBttnSellEnabled(false, 'choose your quantity')
      return
    }
    if (!adjusted) {
      // non-adjusted user input has already been processed by 'input' handler, nothing to do here
      return
    }

    // process "imperfect" (adjusted) user input

    page.qtyFieldSell.value = Doc.formatCoinAtomToLotSizeBaseCurrency(
      adjQtyAtom,
      mkt.baseUnitInfo,
      mkt.cfg.lotsize
    )
    this.chosenQtySellAtom = adjQtyAtom

    this.setSliderSellInput(adjLots) // update slider accordingly

    this.renderSellForm()
  }

  qtyFieldSellUpHandler () {
    const page = this.page
    const mkt = this.market

    const qtyIncrement = this.lotToQtyAtom(1)
    this.chosenQtySellAtom = this.chosenQtySellAtom + qtyIncrement
    page.qtyFieldSell.value = Doc.formatCoinAtomToLotSizeBaseCurrency(
      this.chosenQtySellAtom,
      mkt.baseUnitInfo,
      mkt.cfg.lotsize
    )

    const [, chosenLots] = this.adjustQtyAtoms(this.chosenQtySellAtom)
    this.setSliderSellInput(chosenLots) // update slider accordingly

    this.renderSellForm()
  }

  qtyFieldSellDownHandler () {
    const page = this.page
    const mkt = this.market

    const qtyDecrement = this.lotToQtyAtom(1)
    this.chosenQtySellAtom = Math.max(0, this.chosenQtySellAtom - qtyDecrement) // don't allow negative values
    page.qtyFieldSell.value = Doc.formatCoinAtomToLotSizeBaseCurrency(
      this.chosenQtySellAtom,
      mkt.baseUnitInfo,
      mkt.cfg.lotsize
    )

    const [, chosenLots] = this.adjustQtyAtoms(this.chosenQtySellAtom)
    this.setSliderSellInput(chosenLots) // update slider accordingly

    this.renderSellForm()
  }

  // setSliderBuyInput sets slider input to correspond to lots specified
  setSliderBuyInput (lots: number) {
    const page = this.page
    const mkt = this.market

    // we can only update slider input if max buy has already been fetched
    const maxBuy = mkt.maxBuys[this.chosenRateBuyAtom]
    if (maxBuy) {
      const sliderValue = Math.min(1, lots / maxBuy.swap.lots)
      page.qtySliderBuyInput.value = String(sliderValue)
    }
  }

  // setSliderSellInput sets slider input to correspond to lots specified
  setSliderSellInput (lots: number) {
    const page = this.page
    const mkt = this.market

    // we can only update slider input if max sell has already been fetched
    const maxSell = mkt.maxSell
    if (maxSell) {
      const sliderValue = Math.min(1, lots / maxSell.swap.lots)
      page.qtySliderSellInput.value = String(sliderValue)
    }
  }

  /**
   * parseQtyInput parses quantity input and returns:
   * 1) whether there are any parsing issues (true if none, false when
   *    parsing fails)
   * 2) whether rounding(adjustment) had happened (true when did)
   * 3) adjusted lot value
   * 4) adjusted quantity value in atoms
   *
   * If quantity value couldn't be parsed (parsing issues), the following
   * values are returned: [false, false, 0, 0].
   */
  parseQtyInput (value: string | undefined): [boolean, boolean, number, number] {
    const { market: { baseUnitInfo: bui } } = this

    const qtyRaw = this.parseNumber(value)
    if (qtyRaw === null || isNaN(qtyRaw) || qtyRaw <= 0) {
      return [false, false, 0, 0]
    }
    const qtyRawAtom = convertNumberToAtoms(qtyRaw, bui.conventional.conversionFactor)
    const [adjQtyAtom, adjLots] = this.adjustQtyAtoms(qtyRawAtom)
    const rounded = adjQtyAtom !== qtyRawAtom

    return [true, rounded, adjLots, adjQtyAtom]
  }

  /**
   * parseRateInput parses rate(price) string (in conventional units) and returns:
   * 1) whether there are any parsing issues (true if none, false when
   *    parsing fails)
   * 2) whether rounding(adjustment) to rate-step had happened (true when did)
   * 3) adjusted rate(price) value in atoms
   */
  parseRateInput (value: string | undefined): [boolean, boolean, number] {
    const rateRaw = this.parseNumber(value)
    if (rateRaw === null || isNaN(rateRaw) || rateRaw <= 0) {
      return [false, false, 0]
    }
    const rateRawAtom = convertNumberToAtoms(rateRaw, this.market.rateConversionFactor)
    const adjRateAtom = this.adjustRateAtoms(rateRawAtom)
    const rounded = adjRateAtom !== rateRawAtom

    return [true, rounded, adjRateAtom]
  }

  parseNumber (value: string | undefined): number | null {
    if (!value) {
      return null
    }

    value = value.replace(',', '.') // comma is a typical alternative to dot, allow for it

    // check value doesn't contain invalid characters
    const validPattern = /^-?\d+\.?\d*$/
    if (!value.match(validPattern)) {
      return null
    }

    return parseFloat(value)
  }

  /*
  * adjustQtyAtoms rounds down qtyAtom to a multiple of lot size and returns:
  * 1) adjusted quantity
  * 2) whole number of lots this quantity corresponds to
  */
  adjustQtyAtoms (qtyAtom: number): [number, number] {
    const lotSizeAtom = this.market.cfg.lotsize
    const adjQtyAtom = qtyAtom - (qtyAtom % lotSizeAtom)
    const lots = adjQtyAtom / lotSizeAtom
    return [adjQtyAtom, lots]
  }

  /*
  * adjustRateAtoms rounds down rateAtom to a multiple of rateStep.
  */
  adjustRateAtoms (rateAtom: number): number {
    const rateStepAtom = this.market.cfg.ratestep
    return rateAtom - (rateAtom % rateStepAtom)
  }

  lotToQtyAtom (lots: number): number {
    return lots * this.market.cfg.lotsize
  }

  /* loadTable reloads the table from the current order book information. */
  loadTable () {
    this.loadTableSide(true)
    this.loadTableSide(false)
  }

  /* binOrdersByRateAndEpoch takes a list of sorted orders and returns the
     same orders grouped into arrays. The orders are grouped by their rate
     and whether or not they are epoch queue orders. Epoch queue orders
     will come after non epoch queue orders with the same rate. */
  binOrdersByRateAndEpoch (orders: MiniOrder[]): MiniOrder[][] {
    if (!orders || !orders.length) return []
    const bins = []
    let currEpochBin = []
    let currNonEpochBin = []
    let currRate = orders[0].msgRate
    if (orders[0].epoch) currEpochBin.push(orders[0])
    else currNonEpochBin.push(orders[0])
    for (let i = 1; i < orders.length; i++) {
      if (orders[i].msgRate !== currRate) {
        bins.push(currNonEpochBin)
        bins.push(currEpochBin)
        currEpochBin = []
        currNonEpochBin = []
        currRate = orders[i].msgRate
      }
      if (orders[i].epoch) currEpochBin.push(orders[i])
      else currNonEpochBin.push(orders[i])
    }
    bins.push(currNonEpochBin)
    bins.push(currEpochBin)
    return bins.filter(bin => bin.length > 0)
  }

  /* loadTables loads the order book side into its table. */
  loadTableSide (sell: boolean) {
    const bookSide = sell ? this.book.sells : this.book.buys
    const tbody = sell ? this.page.sellRows : this.page.buyRows
    Doc.empty(tbody)
    if (!bookSide || !bookSide.length) return

    let orderBins = this.binOrdersByRateAndEpoch(bookSide)
    // trim order bins list to avoid exceeding predefined limit per book-side so that all the orders
    // fit on the screen (otherwise we'd need to scroll book-side in UI which is undesirable)
    orderBins = orderBins.slice(0, orderBookSideMaxCapacity)
    orderBins.forEach(bin => {
      const tableRow = this.newOrderTableRow(bin)
      this.setTableOrderRowBackground(tableRow)
      tbody.appendChild(tableRow)
    })
  }

  /* addTableOrder adds a single order to the appropriate table. */
  addTableOrder (order: MiniOrder) {
    const tbody = order.sell ? this.page.sellRows : this.page.buyRows
    let row = tbody.firstChild as OrderRow
    // Handle market order differently.
    if (order.rate === 0) {
      if (order.qtyAtomic === 0) return // a cancel order. TODO: maybe make an indicator on the target order, maybe gray out
      // This is a market order.
      if (row && row.manager.getRate() === 0) {
        row.manager.insertOrder(order)
        this.setTableOrderRowBackground(row)
      } else {
        row = this.newOrderTableRow([order])
        this.setTableOrderRowBackground(row)
        tbody.insertBefore(row, tbody.firstChild)
        // make sure we don't exceed book-side max capacity, note we are doing it after
        // `tbody.insertBefore` call from above to make sure we don't delete `tbody.firstChild`
        // since if we do `tbody.insertBefore` would fail
        if (tbody.childElementCount >= orderBookSideMaxCapacity) {
          tbody.lastChild?.remove()
        }
      }
      return
    }
    // Must be a limit order. Sort by rate. Skip the market order row.
    if (row && row.manager.getRate() === 0) row = row.nextSibling as OrderRow
    while (row) {
      if (row.manager.compare(order) === 0) {
        row.manager.insertOrder(order)
        this.setTableOrderRowBackground(row)
        return
      } else if (row.manager.compare(order) > 0) {
        const tr = this.newOrderTableRow([order])
        this.setTableOrderRowBackground(tr)
        tbody.insertBefore(tr, row)
        // make sure we don't exceed book-side max capacity, note we are doing it after
        // `tbody.insertBefore` call from above to make sure we don't delete `row`
        // since if we do `tbody.insertBefore` would fail
        if (tbody.childElementCount >= orderBookSideMaxCapacity) {
          tbody.lastChild?.remove()
        }
        return
      }
      row = row.nextSibling as OrderRow
    }
    const tr = this.newOrderTableRow([order])
    this.setTableOrderRowBackground(tr)
    tbody.appendChild(tr)
    // make sure we don't exceed book-side max capacity
    if (tbody.childElementCount >= orderBookSideMaxCapacity) {
      tbody.lastChild?.remove()
    }
  }

  /* removeTableOrder removes a single order from its table. */
  removeTableOrder (order: MiniOrder) {
    for (const tbody of [this.page.sellRows, this.page.buyRows]) {
      for (const tr of (Array.from(tbody.children) as OrderRow[])) {
        if (tr.manager.removeOrder(order.id)) {
          return
        }
      }
    }
  }

  /* updateTableOrder looks for the order in the table and updates the qty */
  updateTableOrder (u: RemainderUpdate) {
    for (const tbody of [this.page.sellRows, this.page.buyRows]) {
      for (const tr of (Array.from(tbody.children) as OrderRow[])) {
        if (tr.manager.updateOrderQty(u)) {
          this.setTableOrderRowBackground(tr)
          return
        }
      }
    }
  }

  /* setTableOrderRowBackground updates background to represent order weight visually */
  setTableOrderRowBackground (row: OrderRow) {
    // see how much order price drifted from best in the book (>= 10% would mean the
    // order is completely irrelevant)
    const maxPriceDivergence = 0.10
    let priceDivergence = maxPriceDivergence
    const bestOrder = this.book.bestOrder(row.manager.sell)
    if (!bestOrder) {
      return null
    }
    if (row.manager.sell) {
      priceDivergence = Math.min((row.manager.msgRate - bestOrder.msgRate) / bestOrder.msgRate, maxPriceDivergence)
    } else {
      priceDivergence = Math.min((bestOrder.msgRate - row.manager.msgRate) / bestOrder.msgRate, maxPriceDivergence)
    }
    const priceRelevance = (maxPriceDivergence - priceDivergence) / maxPriceDivergence

    const heaviestOrder = this.book.heaviestOrder(row.manager.sell, maxPriceDivergence)
    if (!heaviestOrder) return
    const rowQtyAtom = row.manager.qtyAtom()
    // rowWeightRatio is capped at 1.0 because heaviestOrder is not necessarily the heaviest
    // in the book (it gotta be heaviest relevant one)
    const rowWeightRatio = Math.min(rowQtyAtom / heaviestOrder.qtyAtomic, 1.0)

    let rowRelevanceColor = State.isDark() ? '#102821' : '#d9f5e1'
    if (row.manager.sell) {
      rowRelevanceColor = State.isDark() ? '#35141D' : '#ffe7e7'
    }
    row.style.background = `linear-gradient(to left, ${rowRelevanceColor} ${priceRelevance * rowWeightRatio * 100}%, transparent 0%)`
  }

  /*
   * clearOrderTableEpochs removes immediate-tif orders whose epoch has expired.
   */
  clearOrderTableEpochs () {
    this.clearOrderTableEpochSide(this.page.sellRows)
    this.clearOrderTableEpochSide(this.page.buyRows)
  }

  /*
   * clearOrderTableEpochs removes immediate-tif orders whose epoch has expired
   * for a single side.
   */
  clearOrderTableEpochSide (tbody: HTMLElement) {
    for (const tr of (Array.from(tbody.children)) as OrderRow[]) {
      tr.manager.removeEpochOrders()
    }
  }

  /*
   * newOrderTableRow creates a new <tr> element to insert into an order table.
     Takes a bin of orders with the same rate, and displays the total quantity.
   */
  newOrderTableRow (orderBin: MiniOrder[]): OrderRow {
    const tr = this.page.orderRowTmpl.cloneNode(true) as OrderRow
    tr.manager = new OrderTableRowManager(tr, orderBin, this.market)
    return tr
  }

  /* handleConnNote handles the 'conn' notification.
   */
  async handleConnNote (note: ConnEventNote) {
    this.marketList.setConnectionStatus(note)
    if (note.connectionStatus === ConnectionStatus.Connected) {
      // Having been disconnected from a DEX server, anything may have changed,
      // or this may be the first opportunity to get the server's config, so
      // fetch it all before reloading the markets page.
      await app().fetchUser()
      await app().loadPage('markets')
    }
  }

  /*
   * filterMarkets sets the display of markets in the markets list based on the
   * value of the search input.
   */
  filterMarkets () {
    const filterTxt = this.page.marketSearchV1.value?.toLowerCase()
    const filter = filterTxt ? (mkt: MarketRow) => mkt.name.includes(filterTxt) : () => true
    this.marketList.setFilter(filter)
  }

  /*
   * loadCandles loads the candles for the current candleDur. If a cache is already
   * active, the cache will be used without a loadcandles request.
   */
  loadCandles (duration: string) {
    const { candleCaches, cfg, baseUnitInfo, quoteUnitInfo } = this.market
    const cache = candleCaches[duration]
    if (cache) {
      this.candleChart.setCandlesAndDraw(cache, cfg, baseUnitInfo, quoteUnitInfo)
      return
    }
    this.reqCandleDuration = duration
    this.requestCandles(duration)
  }

  /* requestCandles sends the loadcandles request. It accepts an optional candle
   * duration which will be requested if it is provided. While request is in
   * progress candle chart animates, the animation ends when response arrives
   * with up-to-date candle data.
   */
  requestCandles (candleDur: string) {
    const { dex, baseCfg, quoteCfg } = this.market
    this.showCandlesLoadingAnimation()
    ws.request('loadcandles', { host: dex.host, base: baseCfg.id, quote: quoteCfg.id, dur: candleDur })
  }

  /*
   * unload is called by the Application when the user navigates away from
   * the /markets page.
   */
  unload () {
    ws.request(unmarketRoute, {})
    ws.deregisterRoute(bookRoute)
    ws.deregisterRoute(bookOrderRoute)
    ws.deregisterRoute(unbookOrderRoute)
    ws.deregisterRoute(updateRemainingRoute)
    ws.deregisterRoute(epochOrderRoute)
    ws.deregisterRoute(candlesRoute)
    ws.deregisterRoute(candleUpdateRoute)
    this.candleChart.unattach()
    Doc.unbind(document, 'keyup', this.keyup)
    clearInterval(this.secondTicker)
  }

  animateErrors (...animations: (() => Animation)[]) {
    for (const ani of this.runningErrAnimations) {
      // Note, animation might still continue executing in background for 1 tick,
      // that shouldn't result in any issues for us though.
      ani.stop()
    }

    this.runningErrAnimations = []
    for (const ani of animations) {
      this.runningErrAnimations.push(ani())
    }
  }
}

/*
 *  MarketList represents the list of exchanges and markets on the left side of
 * markets view. The MarketList provides utilities for adjusting the visibility
 * and sort order of markets.
 */
class MarketList {
  // xcSections: ExchangeSection[]
  div: PageElement
  rowTmpl: PageElement
  markets: MarketRow[]
  selected: MarketRow

  constructor (div: HTMLElement) {
    this.div = div
    this.rowTmpl = Doc.idel(div, 'marketTmplV1')
    Doc.cleanTemplates(this.rowTmpl)
    this.reloadMarketsPane()
  }

  reloadMarketsPane (): void {
    Doc.empty(this.div)
    this.markets = []

    const addMarket = (mkt: ExchangeMarket) => {
      const row = new MarketRow(this.rowTmpl, mkt)
      this.div.appendChild(row.node)
      return row
    }

    for (const mkt of sortedMarkets()) this.markets.push(addMarket(mkt))
    app().bindTooltips(this.div)
  }

  find (host: string, baseID: number, quoteID: number): MarketRow | null {
    for (const row of this.markets) {
      if (row.mkt.xc.host === host && row.mkt.baseid === baseID && row.mkt.quoteid === quoteID) return row
    }
    return null
  }

  /* exists will be true if the specified market exists. */
  exists (host: string, baseID: number, quoteID: number): boolean {
    return this.find(host, baseID, quoteID) !== null
  }

  /* first gets the first market from the first exchange, alphabetically. */
  first (): MarketRow {
    return this.markets[0]
  }

  /* select sets the specified market as selected. */
  select (host: string, baseID: number, quoteID: number) {
    const row = this.find(host, baseID, quoteID)
    if (!row) return console.error(`select: no market row for ${host}, ${baseID}-${quoteID}`)
    for (const mkt of this.markets) mkt.node.classList.remove('selected')
    this.selected = row
    this.selected.node.classList.add('selected')
  }

  /* setConnectionStatus sets the visibility of the disconnected icon based
   * on the core.ConnEventNote.
   */
  setConnectionStatus (note: ConnEventNote) {
    for (const row of this.markets) {
      if (row.mkt.xc.host !== note.host) continue
      if (note.connectionStatus === ConnectionStatus.Connected) Doc.hide(row.tmpl.disconnectedIco)
      else Doc.show(row.tmpl.disconnectedIco)
    }
  }

  /*
   * setFilter sets the visibility of market rows based on the provided filter.
   */
  setFilter (filter: (mkt: MarketRow) => boolean) {
    for (const row of this.markets) {
      if (filter(row)) Doc.show(row.node)
      else Doc.hide(row.node)
    }
  }
}

/*
 * MarketRow represents one row in the MarketList. A MarketRow is a subsection
 * of the ExchangeSection.
 */
class MarketRow {
  node: HTMLElement
  mkt: ExchangeMarket
  name: string
  baseID: number
  quoteID: number
  lotSize: number
  tmpl: Record<string, PageElement>

  constructor (template: HTMLElement, mkt: ExchangeMarket) {
    this.mkt = mkt
    this.name = mkt.name
    this.baseID = mkt.baseid
    this.quoteID = mkt.quoteid
    this.lotSize = mkt.lotsize
    this.node = template.cloneNode(true) as HTMLElement
    const tmpl = this.tmpl = Doc.parseTemplate(this.node)
    tmpl.baseIcon.src = Doc.logoPath(mkt.basesymbol)
    tmpl.quoteIcon.src = Doc.logoPath(mkt.quotesymbol)
    tmpl.baseSymbol.appendChild(Doc.symbolize(mkt.xc.assets[mkt.baseid], true))
    tmpl.quoteSymbol.appendChild(Doc.symbolize(mkt.xc.assets[mkt.quoteid], true))
    if (this.mkt.xc.connectionStatus !== ConnectionStatus.Connected) Doc.show(tmpl.disconnectedIco)
  }
}

/* makeMarket creates a market object that specifies basic market details. */
function makeMarket (host: string, base?: number, quote?: number) {
  return {
    host: host,
    base: base,
    quote: quote
  }
}

/* marketID creates a DEX-compatible market name from the ticker symbols. */
export function marketID (b: string, q: string) { return `${b}_${q}` }

/* convertNumberToAtoms converts number to atoms using provided conversion factor. */
function convertNumberToAtoms (v: number, conversionFactor: number): number {
  // since atomic number is always an integer we need to round it to the nearest
  // integer here, note we are rounding to the closest integer (that should be
  // sufficient to resolve any floating-point errors that might have crept up
  // during floating-point arithmetic) and not just down for example - which would
  // actually result in changing the original value to a slightly different one
  return Math.round(v * conversionFactor)
}

/*
 * wireOrder prepares a copy of the order with the options field converted to a
 * string -> string map.
 */
function wireOrder (order: TradeForm) {
  const stringyOptions: Record<string, string> = {}
  for (const [k, v] of Object.entries(order.options)) stringyOptions[k] = JSON.stringify(v)
  return Object.assign({}, order, { options: stringyOptions })
}

// OrderTableRowManager manages the data within a row in an order table. Each row
// represents all the orders in the order book with the same rate, but orders that
// are booked or still in the epoch queue are displayed in separate rows.
class OrderTableRowManager {
  tableRow: HTMLElement
  page: Record<string, PageElement>
  market: CurrentMarket
  orderBin: MiniOrder[]
  sell: boolean
  msgRate: number
  epoch: boolean
  baseUnitInfo: UnitInfo
  deleted: boolean

  constructor (tableRow: HTMLElement, orderBin: MiniOrder[], market: CurrentMarket) {
    const { baseUnitInfo, quoteUnitInfo, cfg: { ratestep: rateStepAtom } } = market

    this.tableRow = tableRow
    const page = this.page = Doc.parseTemplate(tableRow)
    this.market = market
    this.orderBin = orderBin
    this.sell = orderBin[0].sell
    this.msgRate = orderBin[0].msgRate
    this.epoch = !!orderBin[0].epoch
    this.baseUnitInfo = baseUnitInfo
    this.deleted = false

    Doc.setVis(this.isEpoch() && !this.isSell(), this.page.epochBuy)
    Doc.setVis(this.isEpoch() && this.isSell(), this.page.epochSell)

    if (this.msgRate === 0) {
      page.rate.innerText = 'market'
      this.redrawOrderRowEl()
    } else {
      let colorSellOrBuy = this.isSell() ? 'sellcolor' : 'buycolor'

      page.rate.innerText = Doc.formatRateAtomToRateStep(this.msgRate, baseUnitInfo, quoteUnitInfo, rateStepAtom, this.sell)
      page.rate.classList.add(colorSellOrBuy)

      const updatePriceDelta = () => {
        // make sure this order row hasn't been deleted, otherwise there is no need to keep
        // updating external price (and we want it to get garbage-collected)
        if (this.isDeleted()) {
          return
        }

        const convRate = orderBin[0].rate
        const baseFiatRate = app().fiatRatesMap[market.base.id]
        const quoteFiatRate = app().fiatRatesMap[market.quote.id]
        let priceDeltaFormatted = '(?)'
        if (baseFiatRate && quoteFiatRate) {
          const externalPrice = baseFiatRate / quoteFiatRate

          // calculate the difference between order price and external (e.g. Binance) price
          // note, priceDelta might be negative and that's fine (negative sign will show up in UI)
          let priceDelta: number
          if (this.isSell()) {
            priceDelta = ((convRate - externalPrice) / externalPrice) * 100
          } else {
            priceDelta = ((externalPrice - convRate) / externalPrice) * 100
          }
          // cap price delta for clean UI looks since there is no point to show the exact price
          // delta when it's higher than 9.94% (0.04 will get rounded down to 0.0 guaranteed, it's
          // a simple cut off threshold we can settle for)
          priceDeltaFormatted = '(∞)'
          if (priceDelta < 9.94) {
            priceDeltaFormatted = `(${Doc.formatOneDecimalPrecision(priceDelta)}%)`
          }
          // invert price delta color in case order row is on the other side of "where it should be"
          // compared to external price - to make it clearly visible in UI
          if (priceDelta < 0.0) {
            colorSellOrBuy = this.isSell() ? 'buycolor' : 'sellcolor'
          }
        }
        page.rateDelta.innerText = priceDeltaFormatted
        page.rateDelta.classList.add(colorSellOrBuy)

        this.redrawOrderRowEl()

        // periodically update price delta since external price changes all the time while order row
        // is sitting there in UI
        setTimeout(() => {
          updatePriceDelta()
        }, 5 * 60 * 1000) // 5 minutes delay
      }

      // note, updatePriceDelta will also draw this order row hence it's important to call this only
      // after we are done initializing all the row data needed for drawing
      updatePriceDelta()
    }
  }

  isDeleted (): boolean {
    return this.deleted
  }

  // qty returns total qty in this row (summing up across all orders in this row)
  qtyAtom (): number {
    return this.orderBin.reduce((total, curr) => total + curr.qtyAtomic, 0)
  }

  // updateQtyNumOrdersEl populates the quantity element in the row, displays the
  // number of orders if there is more than one order in the order bin, and also
  // displays "own marker" if the row contains order(s) that belong to the user.
  redrawOrderRowEl () {
    const { page, market, orderBin } = this
    const numOrders = orderBin.length
    page.qty.innerText = Doc.formatCoinAtomToLotSizeBaseCurrency(this.qtyAtom(), market.baseUnitInfo, market.cfg.lotsize)
    if (numOrders > 1) {
      page.numOrders.removeAttribute('hidden')
      page.numOrders.innerText = String(numOrders)
      page.numOrders.title = `quantity is comprised of ${numOrders} orders`
    } else {
      page.numOrders.setAttribute('hidden', 'true')
    }

    // to see if we need to add "own marker" to this row we check against current active
    // orders user has. We receive user orders(updates) through "user notifications feed",
    // while here we are re-drawing order-book table rows as the result of processing
    // "order book feed" events (so, we consume 2 different WS feeds in JS app). Because
    // there is no way to synchronize between events from these 2 feeds the best we can
    // do here is to try and update order book-table rows in delayed manner via issuing
    // 2 setTimeout calls (executing 100ms and 2s into the future), this will provide some
    // time buffer for order notification to get delivered via "user notifications feed"
    // and update corresponding active user orders in JS app. We issue 2 setTimeout calls
    // because the 1st one (having short delay) targets the most likely scenario of active
    // user orders being up-to-date while the 2nd one is just here for the worst case
    // scenario to make sure that we do eventually mark/unmark this row as needed (even
    // in delayed manner, it's still better to resolve it's state properly).
    // Note, because we brute-force all the orders in this row against all active user
    // orders (the freshest version we have) there is no possible issues we can encounter
    // caused by races that might/will happen between different setTimeout calls since
    // every call executes as atomic unit with respect to other similar calls.
    const markUnmarkOwnOrders = () => {
      const userOrders = app().recentOrders(market.dex.host, marketID(market.baseCfg.symbol, market.quoteCfg.symbol))
      let ownOrderSpotted = false
      for (const bin of orderBin) {
        for (const userOrder of userOrders) {
          if (userOrder.id === bin.id) {
            ownOrderSpotted = true
            break
          }
        }
        if (ownOrderSpotted) {
          break
        }
      }
      if (ownOrderSpotted) {
        Doc.show(this.page.ownBookOrder)
      } else {
        // remove "own marker" in case we no longer have user orders in this row
        Doc.hide(this.page.ownBookOrder)
      }
    }
    setTimeout(markUnmarkOwnOrders, 100) // 100ms delay
    setTimeout(markUnmarkOwnOrders, 2000) // 2s delay
  }

  // insertOrder adds an order to the order bin and updates the row elements
  // accordingly.
  insertOrder (order: MiniOrder) {
    this.orderBin.push(order)
    this.redrawOrderRowEl()
  }

  // updateOrderQuantity updates the quantity of the order identified by a token,
  // if it exists in the row, and updates the row elements accordingly. The function
  // returns true if the order is in the bin, and false otherwise.
  updateOrderQty (update: RemainderUpdate) {
    const { id, qty, qtyAtomic } = update
    for (let i = 0; i < this.orderBin.length; i++) {
      if (this.orderBin[i].id === id) {
        this.orderBin[i].qty = qty
        this.orderBin[i].qtyAtomic = qtyAtomic
        this.redrawOrderRowEl()
        return true
      }
    }
    return false
  }

  // removeOrder removes the order identified by id, if it exists in the row,
  // and updates the row elements accordingly. If the order bin is empty, the row is
  // removed from the screen. The function returns true if an order was removed, and
  // false otherwise.
  removeOrder (id: string) {
    const index = this.orderBin.findIndex(order => order.id === id)
    if (index < 0) return false
    this.orderBin.splice(index, 1)
    if (!this.orderBin.length) {
      this.deleted = true
      this.tableRow.remove()
      return true
    }
    this.redrawOrderRowEl()
    return true
  }

  // removeEpochOrders removes all the orders from the row that are not in the
  // new epoch's epoch queue and updates the elements accordingly.
  removeEpochOrders (newEpoch?: number) {
    this.orderBin = this.orderBin.filter((order) => {
      return !(order.epoch && order.epoch !== newEpoch)
    })
    if (!this.orderBin.length) this.tableRow.remove()
    else this.redrawOrderRowEl()
  }

  // getRate returns the rate of the orders in the row.
  getRate () {
    return this.msgRate
  }

  // isEpoch returns whether the orders in this row are in the epoch queue.
  isEpoch () {
    return this.epoch
  }

  // isSell returns whether the orders in this row are sell orders.
  isSell () {
    return this.sell
  }

  // compare takes an order and returns 0 if the order belongs in this row,
  // 1 if the order should go after this row in the table, and -1 if it should
  // be before this row in the table. Sell orders are displayed in ascending order,
  // buy orders are displayed in descending order, and epoch orders always come
  // after booked orders.
  compare (order: MiniOrder) {
    if (this.getRate() === order.msgRate && this.isEpoch() === !!order.epoch) {
      return 0
    } else if (this.getRate() !== order.msgRate) {
      return (this.getRate() > order.msgRate) === order.sell ? 1 : -1
    } else {
      return this.isEpoch() ? 1 : -1
    }
  }
}

interface ExchangeMarket extends Market {
  xc: Exchange
  baseName: string
  bui: UnitInfo
}

function sortedMarkets (): ExchangeMarket[] {
  const mkts: ExchangeMarket[] = []
  const assets = app().assets
  const convertMarkets = (xc: Exchange, mkts: Market[]) => {
    return mkts.map((mkt: Market) => {
      const a = assets[mkt.baseid]
      const baseName = a ? a.name : mkt.basesymbol
      const bui = app().unitInfo(mkt.baseid, xc)
      return Object.assign({ xc, baseName, bui }, mkt)
    })
  }
  for (const xc of Object.values(app().exchanges)) mkts.push(...convertMarkets(xc, Object.values(xc.markets || {})))
  mkts.sort((a: ExchangeMarket, b: ExchangeMarket): number => {
    if (!a.spot) {
      if (b.spot) return 1 // put b first, since we have the spot
      // no spots. compare market name then host name
      if (a.name === b.name) return a.xc.host.localeCompare(b.xc.host)
      return a.name.localeCompare(b.name)
    } else if (!b.spot) return -1 // put a first, since we have the spot
    const [aLots, bLots] = [a.spot.vol24 / a.lotsize, b.spot.vol24 / b.lotsize]
    return bLots - aLots // whoever has more volume by lot count
  })
  return mkts
}

/**
 * highlightOutlineRed returns Animation-factory that will construct Animation that will
 * change element outline color to red and back in a smooth transition.
 * Note: Animation will start when constructed by "new" ^ right away - that's why
 * we return constructor-func here (aka factory), instead of constructing Animation
 * right away.
 */
function highlightOutlineRed (element: PageElement): () => Animation {
  const [r, g, b, a] = State.isDark() ? [203, 94, 94, 0.8] : [153, 48, 43, 0.8]
  return (): Animation => {
    element.style.outline = '2px solid'
    return new Animation(animationLength, (progress: number) => {
      element.style.outlineColor = `rgba(${r}, ${g}, ${b}, ${a - a * progress})`
    },
    'easeIn',
    () => {
      element.style.outlineColor = 'transparent'
    })
  }
}
