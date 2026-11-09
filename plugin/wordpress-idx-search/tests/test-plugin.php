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
	 * The sidecar's path is configurable (BASE_PATH there, idx.basePath in the
	 * Helm chart, which also defines WORDPRESS_IDX_BASE with it). The search
	 * form's script must call that path, not a fixed /idx.
	 */
	public function test_base_path_is_the_path_of_the_sidecar_base() {
		$this->assertSame( '/idx', WordpressIdxSearch::base_path( 'http://127.0.0.1:3000/idx' ) );
		$this->assertSame( '/search', WordpressIdxSearch::base_path( 'http://127.0.0.1:3000/search' ) );
		$this->assertSame( '/a/b', WordpressIdxSearch::base_path( 'https://example.org/a/b/' ) );
		$this->assertSame( '/search', WordpressIdxSearch::base_path( '/search' ) );
	}

	public function test_base_path_falls_back_to_idx() {
		$this->assertSame( '/idx', WordpressIdxSearch::base_path( '' ) );
		$this->assertSame( '/idx', WordpressIdxSearch::base_path( null ) );
		$this->assertSame( '/idx', WordpressIdxSearch::base_path( 'http://127.0.0.1:3000' ) );
		$this->assertSame( '/idx', WordpressIdxSearch::base_path( 'http://127.0.0.1:3000/' ) );
	}

	public function test_replace_marker_passes_the_base_path_to_the_script() {
		$this->plugin->register_assets();
		$this->plugin->replace_marker( 'x ' . WordpressIdxSearch::MARKER );

		$data = (string) wp_scripts()->get_data( 'wordpress-idx-search', 'data' );
		$this->assertSame(
			1,
			preg_match( '/var idxConfig = (\{.*?\});/', $data, $match ),
			'The search script must be told where the sidecar is.'
		);
		$config = json_decode( $match[1], true );
		$this->assertSame( $this->plugin->public_base(), $config['apiBase'] );
		// WORDPRESS_IDX_BASE is not defined in the test suite.
		$this->assertSame( '/idx', $this->plugin->public_base() );
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

	/**
	 * Answer every HTTP request with the given status and body, and keep the
	 * URL and the arguments of each request.
	 */
	private function mock_sidecar_response( $code, array $body ) {
		$calls = new ArrayObject();
		add_filter(
			'pre_http_request',
			function ( $pre, $args, $url ) use ( $code, $body, $calls ) {
				$calls[] = array(
					'url'  => $url,
					'args' => $args,
				);
				return array(
					'headers'  => array(),
					'body'     => wp_json_encode( $body ),
					'response' => array(
						'code'    => $code,
						'message' => '',
					),
					'cookies'  => array(),
				);
			},
			10,
			3
		);
		return $calls;
	}

	public function test_start_reindex_asks_the_sidecar_not_to_wait() {
		update_option( WordpressIdxSearch::OPTION_API_KEY, 'the-key' );
		$calls = $this->mock_sidecar_response( 202, array( 'status' => 'running' ) );

		$this->assertSame( array( 'state' => 'running' ), $this->plugin->start_reindex() );
		$this->assertCount( 1, $calls );
		$this->assertStringEndsWith( '/api/reindex', $calls[0]['url'] );
		$this->assertSame( 'POST', $calls[0]['args']['method'] );
		$this->assertSame( 'respond-async', $calls[0]['args']['headers']['Prefer'] );
		$this->assertSame( 'Bearer the-key', $calls[0]['args']['headers']['Authorization'] );
	}

	public function test_start_reindex_takes_the_answer_of_a_sidecar_that_waited() {
		update_option( WordpressIdxSearch::OPTION_API_KEY, 'the-key' );
		$this->mock_sidecar_response(
			200,
			array(
				'status'  => 'ok',
				'entries' => 12,
			)
		);

		$this->assertSame(
			array(
				'state'   => 'done',
				'entries' => 12,
			),
			$this->plugin->start_reindex()
		);
	}

	public function test_start_reindex_reports_what_the_sidecar_answered() {
		update_option( WordpressIdxSearch::OPTION_API_KEY, 'the-key' );
		$this->mock_sidecar_response( 409, array( 'error' => 'Reindex already in progress.' ) );

		$result = $this->plugin->start_reindex();
		$this->assertWPError( $result );
		$this->assertSame( 'Reindex already in progress.', $result->get_error_message() );

		remove_all_filters( 'pre_http_request' );
		$this->mock_sidecar_response(
			500,
			array(
				'error'   => 'Reindex failed',
				'message' => 'the database does not answer',
			)
		);
		$this->assertSame( 'Reindex failed: the database does not answer', $this->plugin->start_reindex()->get_error_message() );
	}

	public function test_start_reindex_needs_a_key() {
		delete_option( WordpressIdxSearch::OPTION_API_KEY );
		$calls = $this->mock_sidecar_response( 202, array( 'status' => 'running' ) );

		$this->assertWPError( $this->plugin->start_reindex() );
		$this->assertCount( 0, $calls, 'Without a key the sidecar is not called.' );
	}

	public function test_reindex_status_reports_the_state_of_the_rebuild() {
		update_option( WordpressIdxSearch::OPTION_API_KEY, 'the-key' );
		$calls = $this->mock_sidecar_response(
			200,
			array(
				'state'      => 'failed',
				'startedAt'  => '2026-11-09T15:00:00.000Z',
				'finishedAt' => '2026-11-09T15:00:02.000Z',
				'entries'    => null,
				'message'    => 'the database does not answer',
			)
		);

		$this->assertSame(
			array(
				'state'   => 'failed',
				'entries' => null,
				'message' => 'the database does not answer',
			),
			$this->plugin->reindex_status()
		);
		$this->assertSame( 'GET', $calls[0]['args']['method'] );
		$this->assertStringEndsWith( '/api/reindex', $calls[0]['url'] );
	}

	public function test_reindex_status_reports_an_answer_without_a_state_as_an_error() {
		update_option( WordpressIdxSearch::OPTION_API_KEY, 'the-key' );
		$this->mock_sidecar_response( 401, array( 'error' => 'Invalid or missing API key.' ) );

		$result = $this->plugin->reindex_status();
		$this->assertWPError( $result );
		$this->assertSame( 'Invalid or missing API key.', $result->get_error_message() );
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
