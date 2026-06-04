"""设置域模型（re-export 自 entities，保持单一真源）。

M-SET 设计将设置/端点单列；本实现把它们与核心实体统一定义在 entities.py，
此处仅做兼容性导出，便于 ``from ..models.settings import Setting, Endpoint``。
"""
from .entities import Setting, Endpoint, SessionSettingOverride, SettingAudit

__all__ = ["Setting", "Endpoint", "SessionSettingOverride", "SettingAudit"]
