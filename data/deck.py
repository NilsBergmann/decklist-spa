from dataclasses import dataclass, field
from enum import Enum
from functools import total_ordering

from typing import List


class Rarity(str, Enum):
    COMMON = "common"
    UNCOMMON = "uncommon"
    RARE = "rare"
    MYTHIC = "mythic"

    _ORDER = [COMMON, UNCOMMON, RARE, MYTHIC]


class Color(str, Enum):
    WHITE = "W"
    BLUE = "U"
    BLACK = "B"
    RED = "R"
    GREEN = "G"
    COLORLESS = "C"
    MULTI_COLOR = "M"


COLOR_TO_HEX = {
    Color.WHITE: "#b79d58",
    Color.BLUE: "#5e98d9",
    Color.BLACK: "#5e5e5e",
    Color.RED: "#d16e5e",
    Color.GREEN: "#5e9e5e",
    Color.MULTI_COLOR: "#cab34d",
}

RARITY_TO_HEX = {
    Rarity.COMMON: "#000000",
    Rarity.UNCOMMON: "#707883",
    Rarity.RARE: "#a58e4a",
    Rarity.MYTHIC: "#bf4427",
}


@dataclass
class Card:
    name: str
    rarity: Rarity
    type: str
    cost: str
    color: List[Color]
    cmc: int = 0


@dataclass
class Deck:
    name: str
    cards: List[Card] = field(default_factory=list)

    def getColors(self) -> dict[Color, int]:
        colors: dict[Color, int] = {}
        for card in self.cards:
            if card.type == "Token":
                continue
            for color in card.color:
                colors[color] = colors.get(color, 0) + 1
        return colors
