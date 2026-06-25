"""Test cac ham thuan tuy trong module search (khong goi mang)."""
from backend import search


def test_format_results_empty():
    assert search.format_results([]) == ""
    assert search.format_results(None) == ""


def test_format_results_basic():
    results = [
        {"title": "Não người", "snippet": "86 tỷ neuron", "url": "https://x.vn"},
        {"title": "Chỉ tiêu đề", "snippet": "", "url": ""},
    ]
    out = search.format_results(results)
    assert "[1]" in out and "[2]" in out
    assert "Não người" in out
    assert "nguồn: https://x.vn" in out
    # Muc khong co snippet/url van xuat hien
    assert "Chỉ tiêu đề" in out


def test_clean_strips_html():
    assert search._clean("<b>Xin&amp; chào</b>") == "Xin& chào"
