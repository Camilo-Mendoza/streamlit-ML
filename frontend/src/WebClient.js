/*jshint loopfunc:false */

import React, { PureComponent } from 'react';
import { AutoSizer } from 'react-virtualized';
import {
  Alert,
  Col,
  Container,
  Progress,
  Row,
} from 'reactstrap';
import { fromJS } from 'immutable';
import url from 'url';

// Display Elements
import Balloons from './elements/Balloons';
import Chart from './elements/Chart';
import DataFrame from './elements/DataFrame';
import DocString from './elements/DocString';
import ExceptionElement from './elements/ExceptionElement';
import VegaLiteChart from './elements/VegaLiteChart';
import ImageList from './elements/ImageList';
import Map from './elements/Map';
import Table from './elements/Table';
import Text from './elements/Text';

// Other local imports.
import MainMenu from './MainMenu';
import ConnectionStatus from './ConnectionStatus';
import WebsocketConnection from './WebsocketConnection';
import StaticConnection from './StaticConnection';
import StreamlitDialog from './StreamlitDialog';
// import PlayPause from './PlayPause';

import { ForwardMsg, BackMsg, Text as TextProto } from './protobuf';
import { addRows } from './dataFrameProto';
import { toImmutableProto, dispatchOneOf } from './immutableProto';

import './WebClient.css';

/**
 * Port used to connect to the proxy server.
 */
const PROXY_PORT = 5014;

class WebClient extends PureComponent {
  constructor(props) {
    super(props);

    // Initially the state reflects that no data has been received.
    this.state = {
      reportId: '<null>',
      reportName: null,
      elements: fromJS([{
        type: 'text',
        text: {
          format: TextProto.Format.INFO,
          body: 'Ready to receive data',
        }
      }]),
    };

    // Bind event handlers.
    this.handleReconnect = this.handleReconnect.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.closeDialog = this.closeDialog.bind(this);
    this.setConnectionState = this.setConnectionState.bind(this);
    this.setReportName = this.setReportName.bind(this);
    this.saveReport = this.saveReport.bind(this);
    this.rerunScript = this.rerunScript.bind(this);
  }

  componentDidMount() {
    const { query } = url.parse(window.location.href, true);
    if (query.name !== undefined) {
        const reportName = query.name;
        this.setReportName(reportName);
        let uri = `ws://${window.location.hostname}:${PROXY_PORT}/stream/${encodeURIComponent(reportName)}`
        this.connection = new WebsocketConnection({
          uri: uri,
          onMessage: this.handleMessage,
          setConnectionState: this.setConnectionState,
        });
    } else if (query.id !== undefined) {
        this.connection = new StaticConnection({
          reportId: query.id,
          onMessage: this.handleMessage,
          setConnectionState: this.setConnectionState,
          setReportName: this.setReportName,
        });
    } else {
      this.showSingleTextElement(
        'URL must contain either a report name or an ID.',
        TextProto.Format.ERROR
      );
    }
  }

  componentWillUnmount() {
  }

  /**
   * Callback when we establish a websocket connection.
   */
  handleReconnect() {
    // Initially the state reflects that no data has been received.
    this.showSingleTextElement('Established connection.', TextProto.Format.WARNING);
  }

  /**
   * Resets the state of client to an empty report containing a single
   * element which is an alert of the given type.
   *
   * msg    - The message to display
   * format - One of the accepted formats from Text.proto.
   */
  showSingleTextElement(msg, format) {
    this.setState({
      reportId: '<null>',
      elements: fromJS([{
        type: 'text',
        text: {
          format: format,
          body: msg,
        }
      }]),
    });
  }

  /**
   * Callback when we get a message from the server.
   */
  handleMessage(msgProto) {
    const msg = toImmutableProto(ForwardMsg, msgProto);
    dispatchOneOf(msg, 'type', {
      newConnection: (connectionProperties) => {
        this.setState({
          savingConfigured: connectionProperties.get('savingConfigured'),
        });
      },
      newReport: (id) => {
        this.setState({reportId: id});
        setTimeout(() => {
          if (id === this.state.reportId) {
            this.clearOldElements();
          }
        }, 3000);
      },
      delta: (delta) => {
        this.applyDelta(delta);
      },
      reportFinished: () => {
        this.clearOldElements();
      },
      uploadReportProgress: (progress) => {
        this.openDialog({type: 'uploadProgress', progress: progress});
      },
      reportUploaded: (url) => {
        this.openDialog({type: 'uploaded', url: url})
      },
    });
  }

  /**
   * Opens a dialog with the specified state.
   */
  openDialog(dialogProps) {
    this.setState({dialog: dialogProps});
  }

  /**
   * Closes the upload dialog if it's open.
   */
  closeDialog() {
    this.setState({dialog: undefined});
  }

  /**
   * Applies a list of deltas to the elements.
   */
  applyDelta(delta) {
    const reportId = this.state.reportId;
    this.setState(({elements}) => ({
      elements: elements.update(delta.get('id'), (element) =>
          dispatchOneOf(delta, 'type', {
            newElement: (newElement) => newElement.set('reportId', reportId),
            addRows: (newRows) => addRows(element, newRows),
        }))
    }));
  }

  /**
   * Empties out all elements whose reportIds are no longer current.
   */
  clearOldElements() {
    this.setState(({elements, reportId}) => ({
      elements: elements.map((elt) => {
        if (elt.get('reportId') === reportId) {
          return elt;
        } else {
          return fromJS({
            empty: {unused: true},
            reportId: reportId,
            type: "empty"
          });
        }
      })
    }));
  }

  /**
   * Callback to call when we want to save the report.
   */
  saveReport() {
    if (this.state.savingConfigured) {
      this.sendBackMsg('CLOUD_UPLOAD')
    } else {
      this.openDialog({
        type: "warning",
        msg: (
          <div>
            You do not have Amazon S3 or Google GCS sharing configured.
            Please contact&nbsp;
              <a href="mailto:adrien@streamlit.io">Adrien</a>
            &nbsp;to setup sharing.
          </div>
        ),
      });
    }
  }

  /**
   * Callback when the user wants to rerun the script.
   */
  rerunScript() {
    this.openDialog({
      type: "rerunScript",
      commandLine: null,
      onEdit: null,
      rerunCallback: null,
    });
  }

  sendBackMsg(command) {
    if (!this.connection) return;
    const msg = {command: BackMsg.Command[command]};
    this.connection.sendToProxy(msg);
  }

  /**
   * Sets the connection state to given value defined in ConnectionStatus.js.
   * errMsg is an optional error message to display on the screen.
   */
  setConnectionState({connectionState, errMsg}) {
    this.setState({connectionState: connectionState});
    if (errMsg)
      this.showSingleTextElement(errMsg, TextProto.Format.WARNING);
  }

  /**
   * Sets the reportName in state and upates the title bar.
   */
  setReportName(reportName) {
    document.title = `${reportName} (Streamlit)`
    this.setState({reportName});
  }

  render() {
    // Return the tree
    return (
      <div>
        <header>
          <div id="brand">
            <a href="http://streamlit.io">Streamlit</a>
          </div>
          <ConnectionStatus connectionState={this.state.connectionState} />
          <MainMenu
            isHelpPage={this.state.reportName === 'help'}
            connectionState={this.state.connectionState}
            helpButtonCallback={() => this.sendBackMsg('HELP')}
            saveButtonCallback={this.saveReport}
            rerunScriptCallback={this.rerunScript}
          />
        </header>
        <Container className="streamlit-container">
          <Row className="justify-content-center">
            <Col className="col-lg-8 col-md-9 col-sm-12 col-xs-12">
              <AutoSizer className="main">
                { ({width}) => this.renderElements(width) }
              </AutoSizer>
            </Col>
          </Row>

          <StreamlitDialog
            dialogProps={{...this.state.dialog, onClose: this.closeDialog}}
          />

        </Container>
      </div>
    );
  }

  renderElements(width) {
    return this.state.elements.map((element) => {
      try {
        if (!element) throw new Error('Transmission error.');
        return dispatchOneOf(element, 'type', {
          dataFrame: (df) => <DataFrame df={df} width={width}/>,
          chart: (chart) => <Chart chart={chart} width={width}/>,
          vegaLiteChart: (chart) => <VegaLiteChart chart={chart} width={width}/>,
          imgs: (imgs) => <ImageList imgs={imgs} width={width}/>,
          progress: (p) => <Progress value={p.get('value')} style={{width}}/>,
          text: (text) => <Text element={text} width={width}/>,
          docString: (doc) => <DocString element={doc} width={width}/>,
          exception: (exc) => <ExceptionElement element={exc} width={width}/>,
          empty: (empty) => undefined,
          map: (map) => <Map map={map} width={width}/>,
          table: (df) => <Table df={df} width={width}/>,
          balloons: (balloons) => <Balloons balloons={balloons}/>,
        });
      } catch (err) {
        return <Alert color="warning" style={{width}}>{err.message}</Alert>;
      }
    }).push(
      <div style={{width}} className="footer"/>
    ).flatMap((element, indx) => {
      if (element) {
        return [<div className="element-container" key={indx}>{element}</div>];
      } else {
        return [];
      }
    })
  }
}

export default WebClient;
