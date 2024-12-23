import {
  MarketOrderBook,
  MiniOrder
} from './registry'

export default class OrderBook {
  base: number
  baseSymbol: string
  quote: number
  quoteSymbol: string
  buys: MiniOrder[] // includes epoch orders
  sells: MiniOrder[] // includes epoch orders

  constructor (mktBook: MarketOrderBook, baseSymbol: string, quoteSymbol: string) {
    this.base = mktBook.base
    this.baseSymbol = baseSymbol
    this.quote = mktBook.quote
    this.quoteSymbol = quoteSymbol
    // Books are sorted mid-gap first.
    this.buys = mktBook.book.buys || []
    this.sells = mktBook.book.sells || []
  }

  /* add adds an order to the order book. */
  add (ord: MiniOrder) {
    if (ord.qtyAtomic === 0) {
      // TODO: Somebody, for the love of god, figure out why the hell this helps
      // with the ghost orders problem. As far as I know, this order is a booked
      // order that had more than one match in an epoch and completely filled.
      // Because the first match didn't exhaust the order, there would be a
      // 'update_remaining' notification scheduled for the order. But by the
      // time OrderRouter generates the notification long after matching, the
      // order has zero qty left to fill. It's all good though, kinda, because
      // the notification is quickly followed with an 'unbook_order'
      // notification. I have tried my damnedest to catch an update_remaining
      // note without an accompanying unbook_order note, and have thus failed.
      // Yet, this fix somehow seems to work. It's infuriating, tbh.
      window.log('zeroqty', 'zero quantity order encountered', ord)
      return
    }
    const side = ord.sell ? this.sells : this.buys
    side.splice(findIdx(side, ord.rate, !ord.sell), 0, ord)
  }

  /* remove removes an order from the order book. */
  remove (id: string) {
    if (this.removeFromSide(this.sells, id)) return
    this.removeFromSide(this.buys, id)
  }

  /* removeFromSide removes an order from the list of orders. */
  removeFromSide (side: MiniOrder[], id: string) {
    const [ord, i] = this.findOrder(side, id)
    if (ord) {
      side.splice(i, 1)
      return true
    }
    return false
  }

  /* findOrder finds an order in a specified side */
  findOrder (side: MiniOrder[], id: string): [MiniOrder | null, number] {
    for (let i = 0; i < side.length; i++) {
      if (side[i].id === id) {
        return [side[i], i]
      }
    }
    return [null, -1]
  }

  /* updates the remaining quantity of an order. */
  updateRemaining (token: string, qty: number, qtyAtomic: number) {
    if (this.updateRemainingSide(this.sells, token, qty, qtyAtomic)) return
    this.updateRemainingSide(this.buys, token, qty, qtyAtomic)
  }

  /*
   * updateRemainingSide looks for the order in the side and updates the
   * quantity, returning true on success, false if order not found.
   */
  updateRemainingSide (side: MiniOrder[], token: string, qty: number, qtyAtomic: number) {
    const ord = this.findOrder(side, token)[0]
    if (ord) {
      ord.qty = qty
      ord.qtyAtomic = qtyAtomic
      return true
    }
    return false
  }

  /*
   * setEpoch sets the current epoch and clear any orders from previous epochs.
   */
  setEpoch (epochIdx: number) {
    const approve = (ord: MiniOrder) => ord.epoch === undefined || ord.epoch === 0 || ord.epoch === epochIdx
    this.sells = this.sells.filter(approve)
    this.buys = this.buys.filter(approve)
  }

  /* empty will return true if both the buys and sells lists are empty. */
  empty () {
    return !this.sells.length && !this.buys.length
  }

  /* count is the total count of both buy and sell orders. */
  count () {
    return this.sells.length + this.buys.length
  }

  // bestOrder will return the best order in book-side if one exists
  // (including epoch-orders) or null if there are no orders in book-side
  bestOrder (sell: boolean): MiniOrder | null {
    let side = this.buys
    if (sell) {
      side = this.sells
    }

    if (side.length > 0) {
      return side[0]
    }
    return null
  }

  bestBuyRateAtom (): number {
    const bestBuy = this.bestOrder(false)
    if (!bestBuy) {
      return 0
    }
    return bestBuy.msgRate
  }

  bestSellRateAtom (): number {
    const bestSell = this.bestOrder(true)
    if (!bestSell) {
      return 0
    }
    return bestSell.msgRate
  }

  // heaviestOrder will return the order in book-side of highest quantity if one exists
  // (including epoch-orders) or null if there are no orders in book-side, the
  // bestPriceDriftTolerance parameter value is between 0 and 1 (when set) allows for
  // skipping orders with price that's too far from best price for this side of the book
  heaviestOrder (sell: boolean, bestPriceDriftTolerance: number): MiniOrder | null {
    let side = this.buys
    if (sell) {
      side = this.sells
    }
    if (side.length <= 0) {
      return null
    }

    const bestOrder = this.bestOrder(sell)
    if (!bestOrder) {
      return null
    }

    let heaviestOrder = side[0]
    side.forEach((order: MiniOrder) => {
      if (bestPriceDriftTolerance > 0 && bestPriceDriftTolerance <= 1) {
        if (!sell && (bestOrder.msgRate - order.msgRate > bestPriceDriftTolerance * bestOrder.msgRate)) {
          return // order price drifted too far to consider it relevant
        }
        if (sell && (order.msgRate - bestOrder.msgRate > bestPriceDriftTolerance * bestOrder.msgRate)) {
          return // order price drifted too far to consider it relevant
        }
      }
      if (order.qtyAtomic > heaviestOrder.qtyAtomic) {
        heaviestOrder = order
      }
    })
    return heaviestOrder
  }
}

/*
 * findIdx find the index at which to insert the order into the list of orders.
 */
function findIdx (side: MiniOrder[], rate: number, less: boolean): number {
  for (let i = 0; i < side.length; i++) {
    if ((side[i].rate < rate) === less) return i
  }
  return side.length
}
