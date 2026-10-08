"""Pagination defaults shared by every list endpoint.

Contract (docs/api.md §0.1):
    { "count": N, "next": url|null, "previous": url|null, "results": [...] }
"""

from __future__ import annotations

from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class StandardPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200

    def get_paginated_response(self, data: object) -> Response:
        return Response(
            {
                "count": self.page.paginator.count,
                "next": self.get_next_link(),
                "previous": self.get_previous_link(),
                "results": data,
            }
        )
