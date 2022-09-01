const Range = ace.require("ace/range").Range;
var runQueue = [];

function loadAce() {
  //editor
  jQuery(".editor").each(function (index) {
    // console.log("found one in load ace");
    const editorElem = jQuery(this);
    const editor = ace.edit(this);
    editor.setTheme("ace/theme/dracula");
    editor.session.setMode("ace/mode/python");
    // editor.session.setValue(this.text()); //you can set value from xhr here
    jQuery(this).data("aceObject", editor);

    const totalEditorLines = jQuery(this).data("totalLines");
    const readOnly = jQuery(this).data("readOnly");
    const marginTop = jQuery(this).data("marginTop");
    const marginBottom = jQuery(this).data("marginBottom");
    const defaultCode = jQuery(this).data("defaultCode");
    // console.log("default code");
    // console.log(defaultCode);
    if (defaultCode) {
      editor.session.setValue(defaultCode);
      var row = editor.session.getLength() - 1;
      var column = editor.session.getLine(row).length; // or simply Infinity
      editor.selection.moveTo(row, column);
    }

    editor.setFontSize("14px");
    editor.renderer.setScrollMargin(marginTop, marginBottom, 0, 0);
    editor.setShowPrintMargin(false);
    editor.setReadOnly(readOnly);

    editor.setOptions({
      autoScrollEditorIntoView: true,
      copyWithEmptySelection: true,
      maxLines: totalEditorLines,
      minLines: totalEditorLines,
      highlightActiveLine: !readOnly,
      highlightGutterLine: !readOnly,
      enableBasicAutocompletion: true,
      enableSnippets: true,
      enableLiveAutocompletion: true,
    });
    if (readOnly) {
      editor.renderer.$cursorLayer.element.style.display = "none";
    } else {
      editor.session.on("change", function () {
        removeAllHighlights(editor);

        const codeComponentId = editorElem.closest(".code-component").attr("id")
          ? editorElem.closest(".code-component").attr("id")
          : editorElem.closest(".code-component-mcu").attr("id");
        // console.log("CHANGED CODES: " + codeComponentId);
        changedCodes[codeComponentId] = true;
      });
    }
  });

  //console
  jQuery(".output").each(function (index) {
    const output = ace.edit(this);
    output.session.setMode("ace/mode/plain_text");
    output.renderer.setShowGutter(false);
    output.setReadOnly(true);
    jQuery(this).data("aceObject", output);
    output.setFontSize("14px");
    output.renderer.setScrollMargin(10, 0, 0, 0);
    output.renderer.setPadding(15);
    output.setShowPrintMargin(false);

    // make sure we are always scrolled to bottom
    output.session.on("change", () => {
      output.renderer.scrollToLine(Number.POSITIVE_INFINITY);
    });

    const totalOutputLines = jQuery(this).data("totalLines");
    output.setOptions({
      autoScrollEditorIntoView: true,
      copyWithEmptySelection: true,
      highlightActiveLine: false,
      highlightGutterLine: false,
      maxLines: totalOutputLines,
      minLines: totalOutputLines,
    });
    output.prevCursorPosition = output.getCursorPosition();
    output.renderer.$cursorLayer.element.style.display = "none";

    //restrict cursor after the printed part during input
    // output.selection.on("changeCursor", function () {
    //   const currentPosition = output.getCursorPosition();
    //   if (currentPosition.row < output.prevCursorPosition.row) {
    //     output.selection.moveCursorToPosition(output.prevCursorPosition);
    //   } else if (currentPosition.row == output.prevCursorPosition.row) {
    //     if (currentPosition.column < output.prevCursorPosition.column) {
    //       output.selection.moveCursorToPosition(output.prevCursorPosition);
    //     }
    //   }
    // });

    //prevent selection by double triple click during input
    // output.selection.on("changeSelection", function () {
    //   const anchorPosition = output.selection.getSelectionAnchor();
    //   const leadPosition = output.selection.getSelectionLead();

    //   if (
    //     anchorPosition.row < output.prevCursorPosition.row ||
    //     leadPosition.row < output.prevCursorPosition.row
    //   ) {
    //     output.selection.clearSelection();
    //   } else if (
    //     anchorPosition.row == output.prevCursorPosition.row ||
    //     leadPosition.row == output.prevCursorPosition.row
    //   ) {
    //     if (
    //       anchorPosition.column < output.prevCursorPosition.column ||
    //       leadPosition.column < output.prevCursorPosition.column
    //     ) {
    //       output.selection.clearSelection();
    //     }
    //   }
    // });
  });

  //prevent selection by drag and drop during input
  // $(".output").on(
  //   "dragstart ondrop dbclick",
  //   (e) => {
  //     e.stopImmediatePropagation();
  //     e.stopPropagation();
  //     e.preventDefault();
  //     return false;
  //   },
  //   false
  // );
}

function offset(el) {
  var rect = el.getBoundingClientRect(),
    scrollLeft = window.pageXOffset || document.documentElement.scrollLeft,
    scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  return { top: rect.top + scrollTop, left: rect.left + scrollLeft };
}

function builtinRead(x) {
  var externalLibs = {
    "requests.py": "http://location/of/the/lib",
  };
  if (
    Sk.builtinFiles === undefined ||
    Sk.builtinFiles["files"][x] === undefined
  )
    throw "File not found: '" + x + "'";
  if (x in externalLibs) {
    return Sk.misceval.promiseToSuspension(
      fetch(externalLibs[x]).then((r) => r.text())
    );
  }
  // console.log(x);
  return Sk.builtinFiles["files"][x];
}

function removeAllHighlights(editor) {
  // remove all previous markers
  for (markerKey in editor.session.$backMarkers) {
    marker = editor.session.$backMarkers[markerKey];
    // // console.log("marker:")
    // // console.log(marker)
    if (marker.clazz == "myMarker") {
      editor.session.removeMarker(marker.id);
    }
  }
}

function setTimeoutOverride(fn, delay) {
  // create an interval to check for hardInterrupt while things are sleeping
  const interval = setInterval(() => {
    if (Sk.hardInterrupt === true) {
      // hardInterrupt
      clearInterval(interval);
      clearTimeout(timeout);
      fn();
    }
  }, Math.min(delay / 4, 90));
  const timeout = setTimeout(() => {
    clearInterval(interval);
    fn();
  }, delay);
}

var interruptHandler = function (susp) {
  if (Sk.hardInterrupt === true) {
    throw new Sk.builtin.KeyboardInterrupt("aborted execution");
  } else {
    // // console.log("dont do anything");
    return null; // should perform default action
  }
};

function runit(editorElem, outputElem) {
  // hide the reset-walkthrough label
  jQuery(editorElem).parent().parent().find(".reset-walkthrough").hide();
  // hide the run-walkthrough label
  jQuery(editorElem).parent().parent().find(".run-walkthrough").hide();
  //show the stop-walkthrough label
  jQuery(editorElem).parent().parent().find(".stop-walkthrough").show();

  runQueue.push({
    editorElem: editorElem,
    outputElem: outputElem,
    isRunning: false,
  });
  if (runQueue && runQueue[0].isRunning) {
    Sk.hardInterrupt = true;
  } else {
    // // console.log(runQueue);
    runQueue[0].isRunning = true;
    // runQueue = { editorElem: editorElem, outputElem: outputElem };
    var runButton = jQuery(editorElem).parent().prev().prev().prev();
    const stopButton = jQuery(editorElem).parent().prev().prev();
    runButton.children().attr("src", resDirPath + "run-disabled.png");
    runButton.prop("disabled", true);
    runButton.removeClass("active");
    stopButton.children().attr("src", resDirPath + "stop.png");
    stopButton.prop("disabled", false);
    stopButton.addClass("active");
    const editor = jQuery(editorElem).data("aceObject");
    const output = jQuery(outputElem).data("aceObject");
    const isSolutionCode = jQuery(editorElem).data("isSolutionCode");
    const prog = editor.session.getValue();
    output.session.setValue("");
    Sk.pre = "output";
    removeAllHighlights(editor);

    Sk.configure({
      // THIS IS WHEN WE STOP EXECUTION OF THE CODE
      inputfun: function () {
        output.setReadOnly(false);
        // the function returns a promise to give a result back later...
        return new Promise(function (resolve, reject) {
          jQuery(outputElem).on("keydown", function (e) {
            if (e.keyCode == 13) {
              e.preventDefault();
              output.setReadOnly(true);
              jQuery(outputElem).off("keydown");
              output.navigateLineEnd();
              const inputText = output.session.getTextRange(
                new Range(
                  output.prevCursorPosition.row,
                  output.prevCursorPosition.column,
                  output.getCursorPosition().row,
                  output.getCursorPosition().column
                )
              );
              resolve(inputText);
              output.insert("\n");
              output.prevCursorPosition = output.getCursorPosition();
              output.session.setUndoManager(new ace.UndoManager()); //resets undo stack
            }
          });

          stopButton.on("click", function (e) {
            jQuery(outputElem).unbind();
            output.setReadOnly(true);
            return resolve();
          });
        });
      },
      // THIS IS DURING THE CODE EXECUTION SO THAT WE CAN APPEND TO THE OUTPUT ELEM (OUTPUT SHELL)
      output: function (text) {
        /* THIS GETS CALLED EVERY TIME WE ADD TEXT TO THE OUTPUT SHELL */

        output.insert(text);

        output.prevCursorPosition = output.getCursorPosition();
        output.session.setUndoManager(new ace.UndoManager());
      },
      setTimeout: setTimeoutOverride,
      killableWhile: true,
      killableFor: true,
      yieldLimit: 500,
      read: builtinRead,
      __future__: Sk.python3,
      execLimit: Number.POSITIVE_INFINITY,
    });

    // const seen = Symbol("seen"); // I used a symbol so it didn't collide with other data
    // Sk.misceval.asyncToPromise(
    //   function () {
    //     return Sk.importMainWithBody("<stdin>", false, prog, true);
    //   },
    //   {
    //     "*": interruptHandler,
    //     "Sk.promise": (r) => {
    //       interruptHandler();
    //       if (!r.data[seen]) {
    //         r.data[seen] = true;
    //         // make sure we check for an interrupt after the call to sleep
    //         r.data.promise.then((res) => {
    //           interruptHandler();
    //           return res;
    //         });
    //       }
    //     },
    //   }
    // );

    // THIS IS WHERE WE REALLY START RUNNING STUFF
    var myPromise = Sk.misceval.asyncToPromise(
      function () {
        return Sk.importMainWithBody("<stdin>", false, prog, true);
      },
      { "*": interruptHandler }
    );
    // .catch((err) => {
    //   // console.log("WE HAVE THE ERROR");
    // });
    myPromise.then(
      function (mod) {
        /* THIS GETS CALLED WHEN WE ARE FINISHED WITH CODE EXECUTION */

        runQueue.shift();
        Sk.hardInterrupt = false;
        // if (runQueue) {
        //   // console.log("rerunning the runit");
        //   var editorFromQueue = runQueue.editorElem;
        //   var outputFromQueue = runQueue.outputElem;
        //   runQueue = null;
        //   isRunning = false;
        //   runit(editorFromQueue, outputFromQueue);
        // } else {
        //   isRunning = false;
        // }

        const desiredOutput = jQuery(editorElem).data("desiredOutput");
        var codeComponent = jQuery(editorElem).parent().parent();
        const projectId = GetURLParameter("project");
        if (
          desiredOutput.regex &&
          desiredOutput.regex.test(output.getValue())
        ) {
          const confettiCelebration = jQuery(editorElem).data("confetti");
          const isFrontPage = jQuery(editorElem).data("isFrontPage");

          // saveProgress(codeComponent.attr("id"));
          // codeComponent.find(".success-circle").addClass("succeeded");
          // if (!isFrontPage) {
          //   updateChapterSuccess();
          // }

          // successful save this code
          // console.log("SAVE: correct answer");

          // var row = editor.session.getLength() - 1;
          // var column = editor.session.getLine(row).length; // or simply Infinity
          // // console.log(editor.session.getValue());

          const codingComponentSuccessCircle =
            codeComponent.find(".success-circle-component").length > 0
              ? codeComponent.find(".success-circle-component")
              : codeComponent.parent().find(".success-circle-component")
                  .length > 0
              ? codeComponent.parent().find(".success-circle-component")
              : null;
          if (codingComponentSuccessCircle) {
            addCodingAttemptToDB(
              codeComponent.attr("id"),
              projectId,
              editor.session.getValue(),
              null,
              true
            );

            saveProgress(codingComponentSuccessCircle, isFrontPage);
          }
          showSuccessPopup(codeComponent, confettiCelebration);
        } else {
          // ran without errors but it's not successful
          // console.log("SAVE: no error but not the right output");
          const codingComponentSuccessCircle =
            codeComponent.find(".success-circle-component").length > 0
              ? codeComponent.find(".success-circle-component")
              : codeComponent.parent().find(".success-circle-component")
                  .length > 0
              ? codeComponent.parent().find(".success-circle-component")
              : null;
          if (codingComponentSuccessCircle) {
            addCodingAttemptToDB(
              codeComponent.attr("id"),
              projectId,
              editor.session.getValue(),
              null,
              false
            );
          }
        }
        runButton.children().attr("src", resDirPath + "run.png");
        runButton.prop("disabled", false);
        runButton.addClass("active");
        stopButton.children().attr("src", resDirPath + "stop-disabled.png");
        stopButton.prop("disabled", true);
        stopButton.removeClass("active");

        runQueue.forEach(function (item, index) {
          var editorFromQueue = item.editorElem;
          var outputFromQueue = item.outputElem;
          runQueue.shift();
          runit(editorFromQueue, outputFromQueue);
        });
      },
      function (err) {
        const projectId = GetURLParameter("project");
        // console.log(editor.session.getValue());
        // console.log("SAVE: error");

        runQueue.shift();
        Sk.hardInterrupt = false;
        let error;
        if (err instanceof Sk.builtin.KeyboardInterrupt) {
          output.insert("<Program stopped!>");
          error = "Program stopped!";
        } else {
          // err.args.v[2] is the line number for the error
          errLine = err.traceback[0].lineno - 1;

          editor.session.addMarker(
            new Range(errLine, 0, errLine, 1),
            "myMarker",
            "fullLine"
          );
          output.insert("<" + err.toString() + ">");
          error = err.toString();
        }

        var codeComponent = jQuery(editorElem).parent().parent();
        const codingComponentSuccessCircle =
          codeComponent.find(".success-circle-component").length > 0
            ? codeComponent.find(".success-circle-component")
            : codeComponent.parent().find(".success-circle-component").length >
              0
            ? codeComponent.parent().find(".success-circle-component")
            : null;
        if (codingComponentSuccessCircle) {
          addCodingAttemptToDB(
            codeComponent.attr("id"),
            projectId,
            editor.session.getValue(),
            error,
            false
          );
        }

        // // console.log(editor.session);

        runButton.children().attr("src", resDirPath + "run.png");
        runButton.prop("disabled", false);
        runButton.addClass("active");
        stopButton.children().attr("src", resDirPath + "stop-disabled.png");
        stopButton.prop("disabled", true);
        stopButton.removeClass("active");

        runQueue.forEach(function (item, index) {
          var editorFromQueue = item.editorElem;
          var outputFromQueue = item.outputElem;
          runQueue.shift();
          runit(editorFromQueue, outputFromQueue);
        });
      }
    );
  }

  // }, 1000);
}

function resetCode(editorElem, outputElem) {
  if (jQuery(editorElem).data("walkThroughTutorial")) {
    if (
      jQuery(editorElem)
        .parent()
        .parent()
        .find(".reset-walkthrough")
        .is(":visible")
    ) {
      var codeComponent = jQuery(editorElem).parent().parent();
      const confettiCelebration = jQuery(editorElem).data("confetti");
      const isFrontPage = jQuery(editorElem).data("isFrontPage");
      showSuccessPopup(codeComponent, confettiCelebration);
      // if (!isFrontPage) {
      //   saveProgress(codeComponent.attr("id"));
      // }
      // codeComponent.find(".success-circle").addClass("succeeded");
      // if (!isFrontPage) {
      //   updateChapterSuccess();
      // }
      saveProgress(
        codeComponent.find(".success-circle-component"),
        isFrontPage
      );
    }
  }

  // get rid of the stop label and show the refresh label
  jQuery(editorElem).parent().parent().find(".stop-walkthrough").hide();
  jQuery(editorElem).parent().parent().find(".reset-walkthrough").hide();
  jQuery(editorElem).parent().parent().find(".run-walkthrough").show();

  const editor = jQuery(editorElem).data("aceObject");
  const output = jQuery(outputElem).data("aceObject");
  if (runQueue.length > 0 && runQueue[0].isRunning) {
    stopit();
  }

  // this doesn't work because stopit isn't asynchronous
  const defaultCode = jQuery(editorElem).data("defaultCode");
  editor.session.setValue(defaultCode);
  var row = editor.session.getLength() - 1;
  var column = editor.session.getLine(row).length; // or simply Infinity
  editor.selection.moveTo(row, column);
  output.session.setValue("");

  // reset the labels
  var labels = jQuery(editorElem).parent().parent().find(".information-label");
  for (var label of labels) {
    jQuery(label).show();
  }
}

function stopit() {
  // // console.log("sk:");
  // // console.log(Sk);
  Sk.hardInterrupt = true;
  // interruptHandler();
  // Sk.execLimit = 1; //stop all previous execution
  // Sk.timeoutMsg = function () {
  //   // console.log("we're done");
  //   Sk.execLimit = Number.POSITIVE_INFINITY;
  //   return "Program Terminated";
  // };
}

function stopButtonClicked(editorElem) {
  // get rid of the stop label and show the refresh label
  jQuery(editorElem).parent().parent().find(".run-walkthrough").hide();
  jQuery(editorElem).parent().parent().find(".stop-walkthrough").hide();
  jQuery(editorElem).parent().parent().find(".reset-walkthrough").show();

  stopit();
}
