<?php
/**
 * Integration tests for the WordpressIdxSearch plugin class.
 */
class Test_Wordpress_Idx_Search extends WP_UnitTestCase {

	/** @var WordpressIdxSearch */
	private $plugin;

	public function set_up() {
		parent::set_up();
		$this->plugin = new WordpressIdxSearch();
	}

	public function test_sanitize_lang_accepts_known_language() {
		$this->assertSame( 'en', $this->plugin->sanitize_lang( 'en' ) );
		$this->assertSame( 'fr', $this->plugin->sanitize_lang( 'fr' ) );
		$this->assertSame( 'es', $this->plugin->sanitize_lang( 'es' ) );
	}

	public function test_sanitize_lang_falls_back_to_de() {
		$this->assertSame( 'de', $this->plugin->sanitize_lang( 'xx' ) );
		$this->assertSame( 'de', $this->plugin->sanitize_lang( '' ) );
	}

	public function test_sanitize_api_key_only_admin_can_change() {
		update_option( WordpressIdxSearch::OPTION_API_KEY, 'existing-key' );

		$editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $editor );
		$this->assertSame(
			'existing-key',
			$this->plugin->sanitize_api_key( 'new-key' ),
			'Non-admins must not be able to change the API key.'
		);

		$admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );
		$this->assertSame(
			'new-key',
			$this->plugin->sanitize_api_key( 'new-key' ),
			'Admins may set a new API key.'
		);
	}

	public function test_replace_marker_without_marker_is_unchanged() {
		$content = '<p>Nothing to see here.</p>';
		$this->assertSame( $content, $this->plugin->replace_marker( $content ) );
	}

	public function test_replace_marker_injects_form() {
		$this->plugin->register_assets();
		$content = 'before ' . WordpressIdxSearch::MARKER . ' after';
		$out     = $this->plugin->replace_marker( $content );

		$this->assertStringNotContainsString( WordpressIdxSearch::MARKER, $out );
		$this->assertStringContainsString( 'id="idx-search"', $out );
		$this->assertStringContainsString( 'before ', $out );
		$this->assertStringContainsString( ' after', $out );
	}

	/**
	 * Answer every HTTP request with the given manifest and count the calls.
	 */
	private function mock_sidecar_manifest( array $manifest ) {
		$calls = new ArrayObject();
		add_filter(
			'pre_http_request',
			function ( $pre, $args, $url ) use ( $manifest, $calls ) {
				$calls[] = $url;
				return array(
					'headers'  => array(),
					'body'     => wp_json_encode( $manifest ),
					'response' => array(
						'code'    => 200,
						'message' => 'OK',
					),
					'cookies'  => array(),
				);
			},
			10,
			3
		);
		return $calls;
	}

	private function plugin_file() {
		return plugin_basename( dirname( __DIR__ ) . '/wordpress-idx-search.php' );
	}

	public function test_update_check_ignores_a_cached_manifest() {
		// What the previous sidecar served before the pod was upgraded.
		set_transient( WordpressIdxSearch::TRANSIENT_INFO, array( 'version' => '1.0.0' ), HOUR_IN_SECONDS );
		$calls = $this->mock_sidecar_manifest( array( 'version' => '99.0.0' ) );

		$update = $this->plugin->check_for_update( false, array(), $this->plugin_file() );

		$this->assertCount( 1, $calls, 'The update check must ask the sidecar.' );
		$this->assertSame( '99.0.0', $update['new_version'] );
		$this->assertSame(
			array( 'version' => '99.0.0' ),
			get_transient( WordpressIdxSearch::TRANSIENT_INFO ),
			'The fresh manifest must replace the cached one.'
		);
	}

	public function test_update_check_leaves_other_plugins_alone() {
		$calls = $this->mock_sidecar_manifest( array( 'version' => '99.0.0' ) );

		$this->assertFalse( $this->plugin->check_for_update( false, array(), 'other/other.php' ) );
		$this->assertCount( 0, $calls );
	}

	public function test_auto_update_filter_reads_the_cached_manifest() {
		set_transient( WordpressIdxSearch::TRANSIENT_INFO, array( 'auto_update' => false ), HOUR_IN_SECONDS );
		$calls = $this->mock_sidecar_manifest( array( 'auto_update' => true ) );

		$item = (object) array( 'plugin' => $this->plugin_file() );
		$this->assertFalse( $this->plugin->maybe_auto_update( true, $item ) );
		$this->assertCount( 0, $calls, 'The per-row auto-update filter must not hit the sidecar.' );
	}

	public function test_version_is_single_source_of_truth() {
		$plugin_file = dirname( __DIR__ ) . '/wordpress-idx-search.php';
		$data        = get_file_data( $plugin_file, array( 'Version' => 'Version' ) );
		$this->assertSame(
			WordpressIdxSearch::VERSION,
			$data['Version'],
			'Plugin header Version must match the VERSION constant.'
		);

		$readme = file_get_contents( dirname( __DIR__ ) . '/readme.txt' );
		$this->assertMatchesRegularExpression(
			'/^Stable tag: ' . preg_quote( WordpressIdxSearch::VERSION, '/' ) . '$/m',
			$readme,
			'readme.txt Stable tag must match the VERSION constant.'
		);
	}
}
