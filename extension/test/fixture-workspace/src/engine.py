"""Order engine."""

FEE_RATE = 0.001


def helper(x):
    return x + 1


class Engine:
    """Matches orders."""

    def __init__(self):
        self.book = []

    @staticmethod
    def fee(notional):
        return notional * FEE_RATE

    def step(self, order):
        self.book.append(order)
        return helper(len(self.book))
