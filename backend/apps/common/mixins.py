"""Small view mixins shared across apps."""

from __future__ import annotations

from typing import Any

from django.shortcuts import get_object_or_404


class ScopedDetailMixin:
    """Detail lookups resolve against the already user-scoped queryset.

    List endpoints use ``django-filter`` with a required ``workspace``
    parameter. ``GenericAPIView.get_object()`` would otherwise run those
    filters for detail routes too and reject ``/tasks/5/`` with a 400.
    Resolving the object straight from ``get_queryset()`` keeps the isolation
    guarantee (the queryset is per-user) while ignoring list filters.
    """

    def get_object(self) -> Any:
        queryset = self.get_queryset()
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        assert lookup_url_kwarg in self.kwargs, (
            f"Expected view {self.__class__.__name__} to be called with a URL keyword "
            f"argument named {lookup_url_kwarg!r}."
        )
        filter_kwargs = {self.lookup_field: self.kwargs[lookup_url_kwarg]}
        obj = get_object_or_404(queryset, **filter_kwargs)
        self.check_object_permissions(self.request, obj)
        return obj
