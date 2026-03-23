function createJobStatusReporter(jobId, command) {
  const state = {
    jobId: jobId || null,
    lastStage: null,
    lastState: null,
    lastText: null,
    lastDetails: null,
  };

  function report(stage, text, statusState, details) {
    const suffix = formatStatusDetails(details);
    const finalText = suffix ? text + ' [' + suffix + ']' : text;
    state.lastStage = stage || null;
    state.lastState = statusState || null;
    state.lastText = finalText;
    state.lastDetails = details || null;

    if (command && typeof command === 'object') {
      command.__jobStatusState = {
        stage: state.lastStage,
        state: state.lastState,
        text: state.lastText,
        details: state.lastDetails,
      };
    }

    figma.ui.postMessage({
      type: 'status',
      stage: state.lastStage,
      text: finalText,
      state: statusState,
      details: details || null,
    });
  }

  report.loading = function reportLoading(stage, text, details) {
    report(stage, text, 'loading', details);
  };

  report.ok = function reportOk(stage, text, details) {
    report(stage, text, 'ok', details);
  };

  report.error = function reportError(stage, text, details) {
    report(stage, text, 'error', details);
  };

  report.state = state;

  return report;
}
