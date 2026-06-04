"""委派 target 抽象基类（方案 C 接口骨架）。"""
from abc import ABC, abstractmethod


class DelegateTarget(ABC):
    name: str

    @abstractmethod
    async def invoke(self, payload: dict) -> dict:  # -> {text, raw, ...}
        ...
