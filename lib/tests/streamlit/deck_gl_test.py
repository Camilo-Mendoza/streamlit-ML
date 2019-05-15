# Copyright 2019 Streamlit Inc. All rights reserved.

"""deck_gl unit test."""

# Python 2/3 compatibility
from __future__ import print_function, division, unicode_literals, absolute_import
from streamlit.compatibility import setup_2_3_shims
setup_2_3_shims(globals())

import pandas as pd
import json

from tests.streamlit import util
import streamlit as st


df1 = pd.DataFrame({
    'lat': [1, 2, 3, 4],
    'lon': [10, 20, 30, 40],
})

class DeckGLTest(util.DeltaGeneratorTestCase):
    """Test ability to marshall deck_gl_chart protos."""

    def test_no_args(self):
        """Test that it can be called with no args."""
        st.deck_gl_chart()

        c = self.get_delta_from_queue().new_element.deck_gl_chart
        self.assertEqual(c.HasField('data'), False)
        self.assertEqual(json.loads(c.spec), {})

    def test_basic(self):
        """Test that deck_gl_chart can be called with lat/lon."""
        st.deck_gl_chart(df1)

        c = self.get_delta_from_queue().new_element.deck_gl_chart
        self.assertEqual(c.HasField('data'), False)
        self.assertEqual(len(c.layers), 1)
        self.assertEqual(json.loads(c.spec), {})
